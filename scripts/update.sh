#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/check-config.sh
./scripts/backup.sh
docker compose pull postgres
docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
