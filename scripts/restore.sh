#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -ne 1 ]]; then
  echo "Usage : $0 /chemin/vers/atlas-AAAAMMJJ-HHMMSS.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
[[ -r "$BACKUP_FILE" ]] || { echo "Sauvegarde illisible : $BACKUP_FILE" >&2; exit 1; }

POSTGRES_DB_NAME="$(docker compose exec -T postgres sh -eu -c 'printf "%s" "$POSTGRES_DB"' | tr -d '\r\n')"
[[ -n "$POSTGRES_DB_NAME" && "$POSTGRES_DB_NAME" != "postgres" ]] || {
  echo "Nom de base refusé pour une restauration destructive." >&2
  exit 1
}

read -r -p "Cette opération remplacera intégralement la base '$POSTGRES_DB_NAME'. Saisir RESTAURER : " answer
[[ "$answer" == "RESTAURER" ]] || { echo "Restauration annulée."; exit 1; }

services_stopped=false
restart_after_error() {
  status=$?
  if [[ "$status" -ne 0 && "$services_stopped" == true ]]; then
    echo "Échec de la restauration ; tentative de redémarrage des services." >&2
    docker compose start api gateway >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap restart_after_error EXIT

docker compose stop gateway api
services_stopped=true

docker compose exec -T postgres sh -eu -c '
  : "${POSTGRES_USER:?Variable POSTGRES_USER absente du conteneur PostgreSQL}"
  : "${POSTGRES_DB:?Variable POSTGRES_DB absente du conteneur PostgreSQL}"
  case "$POSTGRES_DB" in
    ""|postgres)
      echo "Nom de base refusé pour une restauration destructive." >&2
      exit 1
      ;;
  esac
  dropdb --username "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB"
  createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB"
'

docker compose exec -T postgres sh -eu -c '
  exec pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --no-owner \
    --no-privileges
' < "$BACKUP_FILE"

docker compose start api
for _ in $(seq 1 30); do
  if docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=3)" >/dev/null 2>&1; then
    docker compose start gateway
    services_stopped=false
    trap - EXIT
    echo "Restauration terminée."
    exit 0
  fi
  sleep 2
done

echo "La base est restaurée, mais l'API n'est pas redevenue saine. Consulte les journaux." >&2
exit 1
