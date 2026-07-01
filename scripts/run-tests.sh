#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Les variables de test sont aussi forcées dans tests/conftest.py.
# Ce script fournit une commande stable et explicite pour l’exploitation.
docker compose exec -T api python -m pytest -q
