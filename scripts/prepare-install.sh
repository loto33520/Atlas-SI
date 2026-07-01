#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-}"
if [[ "$MODE" != "local" && "$MODE" != "keycloak" ]]; then
  printf 'Mode d’authentification [local/keycloak] : '
  read -r MODE
fi
[[ "$MODE" == "local" || "$MODE" == "keycloak" ]] || { echo "Mode invalide." >&2; exit 1; }
[[ ! -e .env ]] || { echo "Le fichier .env existe déjà. Il n’a pas été modifié." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl est requis." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 est requis." >&2; exit 1; }

printf 'Protocole de publication [https/http] (défaut https) : '
read -r GATEWAY_SCHEME
GATEWAY_SCHEME="${GATEWAY_SCHEME:-https}"
[[ "$GATEWAY_SCHEME" == "https" || "$GATEWAY_SCHEME" == "http" ]] || { echo "Protocole invalide." >&2; exit 1; }
if [[ "$GATEWAY_SCHEME" == "https" ]]; then
  DEFAULT_PORT=443
  DEFAULT_URL="https://carto.example.org"
  COOKIE_SECURE=true
else
  DEFAULT_PORT=80
  DEFAULT_URL="http://serveur-lab.example.org"
  COOKIE_SECURE=false
fi

printf 'Port publié [%s] : ' "$DEFAULT_PORT"
read -r GATEWAY_PORT
GATEWAY_PORT="${GATEWAY_PORT:-$DEFAULT_PORT}"
[[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] && (( GATEWAY_PORT >= 1 && GATEWAY_PORT <= 65535 )) || { echo "Port invalide." >&2; exit 1; }
if [[ "$GATEWAY_PORT" != "$DEFAULT_PORT" ]]; then
  DEFAULT_URL="${DEFAULT_URL}:${GATEWAY_PORT}"
fi

printf 'URL publique [%s] : ' "$DEFAULT_URL"
read -r PUBLIC_BASE_URL
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$DEFAULT_URL}"
PUBLIC_HOST="$(python3 - "$PUBLIC_BASE_URL" "$GATEWAY_SCHEME" "$GATEWAY_PORT" <<'PY'
from urllib.parse import urlparse
import sys
url = urlparse(sys.argv[1])
scheme = sys.argv[2]
port = int(sys.argv[3])
if url.scheme != scheme or not url.hostname:
    raise SystemExit(1)
actual = url.port or (443 if scheme == 'https' else 80)
if actual != port or url.path not in {'', '/'} or url.query or url.fragment:
    raise SystemExit(1)
print(url.hostname)
PY
)" || { echo "URL publique invalide ou incohérente avec le protocole et le port." >&2; exit 1; }

APP_SECRET_KEY="$(openssl rand -hex 48)"
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
TLS_CERTIFICATE_FILE=""
TLS_PRIVATE_KEY_FILE=""
if [[ "$GATEWAY_SCHEME" == "https" ]]; then
  printf 'Nom du fichier de certificat [atlas-si.fullchain.pem] : '
  read -r TLS_CERTIFICATE_FILE
  TLS_CERTIFICATE_FILE="${TLS_CERTIFICATE_FILE:-atlas-si.fullchain.pem}"
  printf 'Nom du fichier de clé privée [atlas-si.key] : '
  read -r TLS_PRIVATE_KEY_FILE
  TLS_PRIVATE_KEY_FILE="${TLS_PRIVATE_KEY_FILE:-atlas-si.key}"
  for value in "$TLS_CERTIFICATE_FILE" "$TLS_PRIVATE_KEY_FILE"; do
    [[ "$value" != *'/'* && "$value" != *'\\'* && "$value" != *'..'* ]] || { echo "Les noms de certificat doivent être de simples noms de fichiers." >&2; exit 1; }
  done
fi

if [[ "$MODE" == "local" ]]; then
  cp .env.local.example .env
  printf 'Identifiant administrateur [admin] : '
  read -r LOCAL_ADMIN_USERNAME
  LOCAL_ADMIN_USERNAME="${LOCAL_ADMIN_USERNAME:-admin}"
  printf 'Nom affiché [Administrateur Atlas SI] : '
  read -r LOCAL_ADMIN_DISPLAY_NAME
  LOCAL_ADMIN_DISPLAY_NAME="${LOCAL_ADMIN_DISPLAY_NAME:-Administrateur Atlas SI}"
  printf 'Adresse e-mail facultative : '
  read -r LOCAL_ADMIN_EMAIL
  while true; do
    printf 'Mot de passe administrateur (12 caractères minimum) : '
    read -r -s LOCAL_ADMIN_PASSWORD
    printf '\nConfirmer le mot de passe : '
    read -r -s LOCAL_ADMIN_PASSWORD_CONFIRM
    printf '\n'
    [[ ${#LOCAL_ADMIN_PASSWORD} -ge 12 ]] || { echo "Le mot de passe est trop court."; continue; }
    [[ "$LOCAL_ADMIN_PASSWORD" == "$LOCAL_ADMIN_PASSWORD_CONFIRM" ]] || { echo "Les mots de passe diffèrent."; continue; }
    break
  done
  export LOCAL_ADMIN_USERNAME LOCAL_ADMIN_PASSWORD LOCAL_ADMIN_DISPLAY_NAME LOCAL_ADMIN_EMAIL
else
  cp .env.keycloak.example .env
  printf 'URL publique du realm Keycloak : '
  read -r OIDC_ISSUER_URL
  printf 'Identifiant du client [carto-app] : '
  read -r OIDC_CLIENT_ID
  OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-carto-app}"
  printf 'Secret du client Keycloak : '
  read -r -s OIDC_CLIENT_SECRET
  printf '\n'
  [[ -n "$OIDC_ISSUER_URL" && ${#OIDC_CLIENT_SECRET} -ge 8 ]] || { echo "Paramètres Keycloak incomplets." >&2; rm -f .env; exit 1; }
  export OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET
fi

export MODE PUBLIC_BASE_URL PUBLIC_HOST APP_SECRET_KEY POSTGRES_PASSWORD
export GATEWAY_SCHEME GATEWAY_PORT COOKIE_SECURE TLS_CERTIFICATE_FILE TLS_PRIVATE_KEY_FILE
python3 - <<'PY'
import os
from pathlib import Path

path = Path('.env')
lines = path.read_text().splitlines()
updates = {
    'AUTH_MODE': os.environ['MODE'],
    'GATEWAY_SCHEME': os.environ['GATEWAY_SCHEME'],
    'GATEWAY_PORT': os.environ['GATEWAY_PORT'],
    'PUBLIC_BASE_URL': os.environ['PUBLIC_BASE_URL'],
    'PUBLIC_HOST': os.environ['PUBLIC_HOST'],
    'TRUSTED_HOSTS': os.environ['PUBLIC_HOST'],
    'COOKIE_SECURE': os.environ['COOKIE_SECURE'],
    'APP_SECRET_KEY': os.environ['APP_SECRET_KEY'],
    'POSTGRES_PASSWORD': os.environ['POSTGRES_PASSWORD'],
    'TLS_CERTIFICATE_FILE': os.environ.get('TLS_CERTIFICATE_FILE', ''),
    'TLS_PRIVATE_KEY_FILE': os.environ.get('TLS_PRIVATE_KEY_FILE', ''),
}
if os.environ['MODE'] == 'local':
    updates.update({
        'LOCAL_ADMIN_USERNAME': os.environ['LOCAL_ADMIN_USERNAME'],
        'LOCAL_ADMIN_PASSWORD': os.environ['LOCAL_ADMIN_PASSWORD'],
        'LOCAL_ADMIN_DISPLAY_NAME': f'"{os.environ["LOCAL_ADMIN_DISPLAY_NAME"].replace(chr(34), "")}"',
        'LOCAL_ADMIN_EMAIL': os.environ.get('LOCAL_ADMIN_EMAIL', ''),
    })
else:
    updates.update({
        'OIDC_ISSUER_URL': os.environ['OIDC_ISSUER_URL'].rstrip('/'),
        'OIDC_CLIENT_ID': os.environ['OIDC_CLIENT_ID'],
        'OIDC_CLIENT_SECRET': os.environ['OIDC_CLIENT_SECRET'],
    })
output = []
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key = line.split('=', 1)[0].strip()
        if key in updates:
            line = f'{key}={updates[key]}'
    output.append(line)
path.write_text('\n'.join(output) + '\n')
PY

chmod 600 .env
mkdir -p certs backups
chmod 700 backups

printf '\nConfiguration créée : %s/.env\n' "$ROOT_DIR"
printf 'Authentification : %s\n' "$MODE"
printf 'Publication : %s://%s sur le port %s\n' "$GATEWAY_SCHEME" "$PUBLIC_HOST" "$GATEWAY_PORT"
if [[ "$GATEWAY_SCHEME" == "https" ]]; then
  printf 'Déposer %s et %s dans certs/.\n' "$TLS_CERTIFICATE_FILE" "$TLS_PRIVATE_KEY_FILE"
else
  printf 'Mode HTTP : aucun certificat n’est nécessaire. Réserver ce mode à un laboratoire ou à un frontal TLS externe.\n'
fi
printf 'Prochaines étapes :\n'
printf '  sudo ./scripts/check-config.sh\n'
printf '  sudo docker compose build --pull\n'
printf '  sudo docker compose up -d\n'
