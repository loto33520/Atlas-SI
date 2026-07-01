#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_IMAGE="${1:-postgres:18.4-alpine3.23}"
TARGET_VOLUME="atlas_postgres_data_v18_$(date +%Y%m%d%H%M%S)"
ENV_BACKUP=".env.before-postgres18-$(date +%Y%m%d-%H%M%S)"
MIGRATION_DONE=false
ENV_CHANGED=false

fail() { printf '\033[31mERREUR : %s\033[0m\n' "$1" >&2; exit 1; }
info() { printf '\033[36m%s\033[0m\n' "$1"; }

[[ -f .env ]] || fail "Le fichier .env est absent."
command -v docker >/dev/null 2>&1 || fail "Docker est absent."
docker compose version >/dev/null 2>&1 || fail "Docker Compose est absent."

docker compose ps postgres --status running --quiet | grep -q . || fail "Le service PostgreSQL doit être démarré."
CURRENT_MAJOR="$(docker compose exec -T postgres sh -c 'postgres --version' | sed -E 's/.* ([0-9]+)(\..*)?$/\1/' | tr -d '\r\n')"
[[ "$CURRENT_MAJOR" == "17" ]] || fail "Cette procédure attend PostgreSQL 17 ; version détectée : $CURRENT_MAJOR."
[[ "$TARGET_IMAGE" == postgres:18* || "$TARGET_IMAGE" == */postgres:18* ]] || fail "L’image cible doit être une image PostgreSQL 18."

cp .env "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"

rollback() {
  status=$?
  if [[ "$status" -ne 0 && "$MIGRATION_DONE" != true ]]; then
    printf '\n\033[31mLa migration a échoué. Restauration de la configuration PostgreSQL 17.\033[0m\n' >&2
    if [[ "$ENV_CHANGED" == true && -f "$ENV_BACKUP" ]]; then
      cp "$ENV_BACKUP" .env
      chmod 600 .env
    fi
    docker compose up -d postgres api gateway >/dev/null 2>&1 || true
    printf 'L’ancien volume n’a pas été supprimé. Le nouveau volume éventuel est : %s\n' "$TARGET_VOLUME" >&2
  fi
  exit "$status"
}
trap rollback EXIT

info "1/7 — Sauvegarde logique de PostgreSQL 17"
BACKUP_OUTPUT="$(./scripts/backup.sh)"
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Sauvegarde créée : //p' | tail -1)"
[[ -s "$BACKUP_FILE" ]] || fail "La sauvegarde n’a pas été retrouvée."

info "2/7 — Arrêt des services"
docker compose stop gateway api postgres

info "3/7 — Préparation d’un nouveau volume PostgreSQL 18"
docker volume create "$TARGET_VOLUME" >/dev/null

python3 - "$TARGET_IMAGE" "$TARGET_VOLUME" <<'PY'
from pathlib import Path
import sys

path = Path('.env')
image, volume = sys.argv[1:]
updates = {
    'POSTGRES_IMAGE': image,
    'POSTGRES_DATA_PATH': '/var/lib/postgresql',
    'POSTGRES_VOLUME_NAME': volume,
}
lines = path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key = line.split('=', 1)[0].strip()
        if key in updates:
            line = f'{key}={updates[key]}'
            seen.add(key)
    out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f'{key}={value}')
path.write_text('\n'.join(out) + '\n')
PY
chmod 600 .env
ENV_CHANGED=true

info "4/7 — Initialisation de PostgreSQL 18"
docker compose up -d postgres
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "$(docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_USER"')" -d "$(docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose exec -T postgres pg_isready >/dev/null 2>&1 || fail "PostgreSQL 18 n’est pas devenu disponible."
NEW_MAJOR="$(docker compose exec -T postgres sh -c 'postgres --version' | sed -E 's/.* ([0-9]+)(\..*)?$/\1/' | tr -d '\r\n')"
[[ "$NEW_MAJOR" == "18" ]] || fail "La version démarrée n’est pas PostgreSQL 18 : $NEW_MAJOR."

info "5/7 — Restauration des données"
docker compose exec -T postgres sh -eu -c '
  case "$POSTGRES_DB" in ""|postgres) exit 2;; esac
  dropdb --username "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
  createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB"
'
docker compose exec -T postgres sh -eu -c '
  exec pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error
' < "$BACKUP_FILE"

info "6/7 — Redémarrage et validation de l’application"
docker compose up -d api gateway
for _ in $(seq 1 60); do
  if docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=3)" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=3)" >/dev/null || fail "L’API n’est pas redevenue disponible."

info "7/7 — Contrôles finaux"
docker compose exec -T postgres sh -c 'postgres --version'
docker compose exec -T api alembic current
docker compose ps

MIGRATION_DONE=true
trap - EXIT
printf '\nMigration terminée.\n'
printf 'Sauvegarde utilisée : %s\n' "$BACKUP_FILE"
printf 'Ancienne configuration : %s\n' "$ENV_BACKUP"
printf 'Nouveau volume : %s\n' "$TARGET_VOLUME"
printf 'L’ancien volume PostgreSQL 17 est conservé pour permettre un retour arrière manuel.\n'
