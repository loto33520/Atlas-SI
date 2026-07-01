#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 - <<'PY'
from pathlib import Path

def dotenv(path):
    values = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip().strip('"').strip("'")
        values[key.strip()] = value
    return values

v = dotenv('.env')
items = [
    ('PostgreSQL', v.get('POSTGRES_IMAGE', 'postgres:17.10-alpine3.23')),
    ('Python API', v.get('PYTHON_IMAGE', 'python:3.13.14-slim-trixie')),
    ('Node build', v.get('NODE_IMAGE', 'node:24.18.0-alpine3.23')),
    ('Nginx', v.get('NGINX_IMAGE', 'nginx:1.30.3-alpine3.23')),
]
for label, image in items:
    print(f'{label:12} : {image}')
PY

if docker compose ps postgres --status running --quiet 2>/dev/null | grep -q .; then
  printf '\nVersions exécutées :\n'
  docker compose exec -T postgres sh -c 'postgres --version'
fi
if docker compose ps api --status running --quiet 2>/dev/null | grep -q .; then
  docker compose exec -T api python --version
fi
if docker compose ps gateway --status running --quiet 2>/dev/null | grep -q .; then
  docker compose exec -T gateway nginx -v 2>&1
fi
