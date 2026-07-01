#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

printf '=== Services ===\n'
docker compose ps

printf '\n=== Santé API interne ===\n'
docker compose exec -T api python - <<'PY'
import json
import urllib.request
for path in ("live", "ready"):
    with urllib.request.urlopen(f"http://127.0.0.1:8000/api/health/{path}", timeout=5) as response:
        print(path, response.status, json.loads(response.read()))
with urllib.request.urlopen("http://127.0.0.1:8000/api/auth/config", timeout=5) as response:
    print("auth", response.status, json.loads(response.read()))
PY

AUTH_MODE="$(docker compose exec -T api sh -c 'printf %s "$AUTH_MODE"')"
printf '\n=== Authentification : %s ===\n' "$AUTH_MODE"

if [[ "$AUTH_MODE" == "keycloak" ]]; then
  docker compose exec -T api python - <<'PY'
import json
import os
import socket
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

url = os.environ["OIDC_ISSUER_URL"].rstrip("/") + "/.well-known/openid-configuration"
parsed = urlparse(url)
host = parsed.hostname
port = parsed.port or (443 if parsed.scheme == "https" else 80)
print("URL", url)
try:
    addresses = sorted({item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
    print("DNS", ", ".join(addresses))
except OSError as exc:
    print("ERREUR DNS", repr(exc))
    sys.exit(2)
try:
    with socket.create_connection((host, port), timeout=5):
        print("TCP", f"{host}:{port}", "OK")
except OSError as exc:
    print("ERREUR TCP", repr(exc))
    sys.exit(3)
try:
    with urllib.request.urlopen(url, timeout=10) as response:
        data = json.loads(response.read())
        print("HTTP", response.status)
        print("issuer", data.get("issuer"))
        print("authorization_endpoint", data.get("authorization_endpoint"))
        print("token_endpoint", data.get("token_endpoint"))
        print("jwks_uri", data.get("jwks_uri"))
except urllib.error.URLError as exc:
    print("ERREUR HTTP/TLS", repr(exc))
    sys.exit(4)
PY
else
  docker compose exec -T api python - <<'PY'
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
username = os.environ["LOCAL_ADMIN_USERNAME"].strip().casefold()
with engine.connect() as connection:
    row = connection.execute(
        text("SELECT username, active, app_roles FROM local_users WHERE username = :username"),
        {"username": username},
    ).mappings().first()
if not row:
    raise SystemExit("ERREUR : compte administrateur local absent")
print("Compte local", row["username"], "actif=" + str(row["active"]), "rôles=" + str(row["app_roles"]))
PY
fi

printf '\n=== Publication Web ===\n'
PUBLIC_INFO="$(docker compose exec -T api python - <<'PY2'
from urllib.parse import urlparse
import os
u = urlparse(os.environ['PUBLIC_BASE_URL'])
print(u.scheme)
print(u.hostname or '')
print(u.port or (443 if u.scheme == 'https' else 80))
print(os.environ['PUBLIC_BASE_URL'])
PY2
)"
mapfile -t WEB <<< "$PUBLIC_INFO"
WEB_SCHEME="${WEB[0]}"
PUBLIC_HOST="${WEB[1]}"
PUBLIC_PORT="${WEB[2]}"
PUBLIC_URL="${WEB[3]}"
printf 'URL : %s\n' "$PUBLIC_URL"
if [[ "$WEB_SCHEME" == "https" ]]; then
  echo | openssl s_client -connect "$PUBLIC_HOST:$PUBLIC_PORT" -servername "$PUBLIC_HOST" 2>/dev/null | openssl x509 -noout -subject -issuer -dates
else
  python3 - "$PUBLIC_URL" <<'PY3'
import sys, urllib.request
url = sys.argv[1].rstrip('/') + '/api/health/live'
with urllib.request.urlopen(url, timeout=10) as response:
    print('HTTP', response.status, response.read().decode('utf-8'))
PY3
fi
