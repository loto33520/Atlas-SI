#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS doit être un nombre entier positif." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/atlas-${stamp}.dump"
tmp_file="${file}.tmp"

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

docker compose exec -T postgres sh -eu -c '
  : "${POSTGRES_USER:?Variable POSTGRES_USER absente du conteneur PostgreSQL}"
  : "${POSTGRES_DB:?Variable POSTGRES_DB absente du conteneur PostgreSQL}"
  exec pg_dump \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format custom \
    --no-owner \
    --no-privileges
' > "$tmp_file"

if [[ ! -s "$tmp_file" ]]; then
  echo "La sauvegarde produite est vide ; elle n'est pas conservée." >&2
  exit 1
fi

mv "$tmp_file" "$file"
chmod 600 "$file"
find "$BACKUP_DIR" -type f -name 'atlas-*.dump' -mtime "+$RETENTION_DAYS" -delete
printf 'Sauvegarde créée : %s\n' "$file"
