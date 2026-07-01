#!/bin/sh
set -eu

if [ "${ATLAS_SKIP_BOOTSTRAP:-false}" != "true" ]; then
  alembic upgrade head
  python -m app.seed
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --log-level "$(printf '%s' "${LOG_LEVEL:-INFO}" | tr '[:upper:]' '[:lower:]')"
