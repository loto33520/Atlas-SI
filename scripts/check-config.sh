#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { printf '\033[31mERREUR : %s\033[0m\n' "$1" >&2; exit 1; }
ok() { printf '\033[32mOK : %s\033[0m\n' "$1"; }
warn() { printf '\033[33mAVERTISSEMENT : %s\033[0m\n' "$1" >&2; }

command -v docker >/dev/null 2>&1 || fail "Docker n'est pas installé."
docker compose version >/dev/null 2>&1 || fail "Le module Docker Compose n'est pas disponible."
command -v python3 >/dev/null 2>&1 || fail "Python 3 est requis pour contrôler la configuration."
[[ -f .env ]] || fail "Le fichier .env est absent. Copie .env.local.example ou .env.keycloak.example puis complète-le."

parsed_output="$(python3 - <<'PY'
from pathlib import Path
from urllib.parse import urlparse


def dotenv(path: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        result[key.strip()] = value
    return result


def required(values: dict[str, str], key: str) -> str:
    value = values.get(key, '').strip()
    if not value or 'CHANGE_ME' in value:
        raise SystemExit(f'{key} doit être renseigné')
    return value


def simple_filename(value: str, key: str) -> str:
    value = value.strip()
    if not value:
        raise SystemExit(f'{key} doit être renseigné en mode HTTPS')
    if '/' in value or '\\' in value or value in {'.', '..'} or '..' in value:
        raise SystemExit(f'{key} doit contenir un nom de fichier simple, sans chemin ni ..')
    return value

values = dotenv('.env')
secret = required(values, 'APP_SECRET_KEY')
if len(secret) < 32:
    raise SystemExit('APP_SECRET_KEY doit contenir au moins 32 caractères')
for key in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'PUBLIC_BASE_URL'):
    required(values, key)

scheme = values.get('GATEWAY_SCHEME', 'https').strip().lower()
if scheme not in {'http', 'https'}:
    raise SystemExit('GATEWAY_SCHEME doit valoir http ou https')
try:
    port = int(values.get('GATEWAY_PORT', '443' if scheme == 'https' else '80').strip())
except ValueError as exc:
    raise SystemExit('GATEWAY_PORT doit être un entier') from exc
if not 1 <= port <= 65535:
    raise SystemExit('GATEWAY_PORT doit être compris entre 1 et 65535')

url = urlparse(values['PUBLIC_BASE_URL'])
if url.scheme != scheme:
    raise SystemExit('Le protocole de PUBLIC_BASE_URL doit correspondre à GATEWAY_SCHEME')
if not url.hostname:
    raise SystemExit('PUBLIC_BASE_URL est invalide')
if url.username or url.password:
    raise SystemExit('PUBLIC_BASE_URL ne doit pas contenir d’identifiant')
if url.path not in {'', '/'} or url.query or url.fragment:
    raise SystemExit('PUBLIC_BASE_URL doit désigner la racine du site, sans chemin, requête ni fragment')
url_port = url.port or (443 if scheme == 'https' else 80)
if url_port != port:
    raise SystemExit('Le port de PUBLIC_BASE_URL doit correspondre à GATEWAY_PORT')

configured_host = values.get('PUBLIC_HOST', url.hostname).strip()
if configured_host != url.hostname:
    raise SystemExit('PUBLIC_HOST doit correspondre au nom DNS de PUBLIC_BASE_URL')

cookie_secure = values.get('COOKIE_SECURE', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
if scheme == 'https' and not cookie_secure:
    raise SystemExit('COOKIE_SECURE doit valoir true en mode HTTPS')
if scheme == 'http' and cookie_secure:
    raise SystemExit('COOKIE_SECURE doit valoir false en mode HTTP')

mode = values.get('AUTH_MODE', 'keycloak').strip().lower()
if mode not in {'local', 'keycloak'}:
    raise SystemExit('AUTH_MODE doit valoir local ou keycloak')
if mode == 'local':
    password = values.get('LOCAL_ADMIN_PASSWORD', '')
    if not values.get('LOCAL_ADMIN_USERNAME', '').strip():
        raise SystemExit('LOCAL_ADMIN_USERNAME doit être renseigné en mode local')
    if len(password) < 12 or 'CHANGE_ME' in password:
        raise SystemExit('LOCAL_ADMIN_PASSWORD doit contenir au moins 12 caractères et ne plus contenir CHANGE_ME')
else:
    for key in ('OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'):
        value = values.get(key, '')
        if not value or 'CHANGE_ME' in value:
            raise SystemExit(f'{key} doit être renseigné en mode keycloak')
    if len(values['OIDC_CLIENT_SECRET']) < 8:
        raise SystemExit('OIDC_CLIENT_SECRET doit contenir au moins 8 caractères')

cert = ''
key = ''
if scheme == 'https':
    cert = simple_filename(values.get('TLS_CERTIFICATE_FILE', ''), 'TLS_CERTIFICATE_FILE')
    key = simple_filename(values.get('TLS_PRIVATE_KEY_FILE', ''), 'TLS_PRIVATE_KEY_FILE')

print(f'AUTH_MODE={mode}')
print(f'PUBLIC_HOST={url.hostname}')
print(f'GATEWAY_SCHEME={scheme}')
print(f'GATEWAY_PORT={port}')
print(f'TLS_CERTIFICATE_FILE={cert}')
print(f'TLS_PRIVATE_KEY_FILE={key}')
PY
)" || fail "Le fichier .env est invalide."

AUTH_MODE=""
PUBLIC_HOST=""
GATEWAY_SCHEME=""
GATEWAY_PORT=""
TLS_CERTIFICATE_FILE=""
TLS_PRIVATE_KEY_FILE=""
while IFS= read -r line; do
  case "$line" in
    AUTH_MODE=*) AUTH_MODE="${line#AUTH_MODE=}" ;;
    PUBLIC_HOST=*) PUBLIC_HOST="${line#PUBLIC_HOST=}" ;;
    GATEWAY_SCHEME=*) GATEWAY_SCHEME="${line#GATEWAY_SCHEME=}" ;;
    GATEWAY_PORT=*) GATEWAY_PORT="${line#GATEWAY_PORT=}" ;;
    TLS_CERTIFICATE_FILE=*) TLS_CERTIFICATE_FILE="${line#TLS_CERTIFICATE_FILE=}" ;;
    TLS_PRIVATE_KEY_FILE=*) TLS_PRIVATE_KEY_FILE="${line#TLS_PRIVATE_KEY_FILE=}" ;;
  esac
done <<< "$parsed_output"
[[ -n "$AUTH_MODE" && -n "$PUBLIC_HOST" && -n "$GATEWAY_SCHEME" && -n "$GATEWAY_PORT" ]] || fail "Impossible d'analyser le fichier .env."

chmod 600 .env

if [[ "$GATEWAY_SCHEME" == "https" ]]; then
  command -v openssl >/dev/null 2>&1 || fail "OpenSSL est requis pour contrôler le certificat HTTPS."
  CERT_PATH="certs/$TLS_CERTIFICATE_FILE"
  KEY_PATH="certs/$TLS_PRIVATE_KEY_FILE"
  [[ -f "$CERT_PATH" ]] || fail "Le certificat complet est absent : $CERT_PATH"
  [[ -f "$KEY_PATH" ]] || fail "La clé privée est absente : $KEY_PATH"
  openssl x509 -in "$CERT_PATH" -noout >/dev/null 2>&1 || fail "Le certificat PEM est illisible."
  openssl pkey -in "$KEY_PATH" -noout >/dev/null 2>&1 || fail "La clé privée PEM est illisible ou protégée par une phrase secrète."
  openssl x509 -in "$CERT_PATH" -noout -checkhost "$PUBLIC_HOST" >/dev/null 2>&1 || fail "Le certificat ne couvre pas $PUBLIC_HOST."
  cert_hash="$(openssl x509 -in "$CERT_PATH" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
  key_hash="$(openssl pkey -in "$KEY_PATH" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
  [[ "$cert_hash" == "$key_hash" ]] || fail "La clé privée ne correspond pas au certificat."
fi

[[ -f frontend/package-lock.json ]] || fail "Le fichier frontend/package-lock.json est absent."
if grep -q "packages.applied-caas-gateway" frontend/package-lock.json; then
  fail "Le verrou npm contient une adresse de dépôt interne non distribuable."
fi
if grep -q 'pluginutils-1\.0\.2\.tgz' frontend/package-lock.json; then
  fail "Le verrou npm référence @rolldown/pluginutils 1.0.2, version indisponible."
fi

image_output="$(python3 - <<'PY2'
from pathlib import Path

def dotenv(path: str) -> dict[str, str]:
    result = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        result[key.strip()] = value
    return result

values = dotenv('.env')
def get(name, default):
    value = values.get(name, default).strip()
    if not value or any(ch.isspace() for ch in value):
        raise SystemExit(f'{name} contient une valeur invalide')
    return value

images = {
    'POSTGRES_IMAGE': get('POSTGRES_IMAGE', 'postgres:18.4-alpine3.23'),
    'PYTHON_IMAGE': get('PYTHON_IMAGE', 'python:3.13.14-slim-trixie'),
    'NODE_IMAGE': get('NODE_IMAGE', 'node:24.18.0-alpine3.23'),
    'NGINX_IMAGE': get('NGINX_IMAGE', 'nginx:1.30.3-alpine3.23'),
}
allow_latest = values.get('ALLOW_LATEST_IMAGES', 'false').strip().lower() in {'1','true','yes','on'}
for name, value in images.items():
    tag = value.rsplit(':', 1)[-1].lower() if ':' in value.rsplit('/',1)[-1] else 'latest'
    if tag == 'latest' and not allow_latest:
        raise SystemExit(f'{name} utilise latest. Définir ALLOW_LATEST_IMAGES=true pour l’autoriser explicitement.')

pg_image = images['POSTGRES_IMAGE']
pg_tag = pg_image.rsplit(':', 1)[-1] if ':' in pg_image.rsplit('/',1)[-1] else 'latest'
pg_major = pg_tag.split('.',1)[0].split('-',1)[0]
pg_path = values.get('POSTGRES_DATA_PATH', '/var/lib/postgresql').strip()
if pg_major.isdigit() and int(pg_major) >= 18 and pg_path != '/var/lib/postgresql':
    raise SystemExit('PostgreSQL 18+ exige POSTGRES_DATA_PATH=/var/lib/postgresql dans cette distribution.')
if pg_major.isdigit() and int(pg_major) <= 17 and pg_path != '/var/lib/postgresql/data':
    raise SystemExit('PostgreSQL 17 et antérieur exige POSTGRES_DATA_PATH=/var/lib/postgresql/data dans cette distribution.')

print(f'ALLOW_LATEST_IMAGES={str(allow_latest).lower()}')
for name, value in images.items():
    print(f'{name}={value}')
print(f'POSTGRES_DATA_PATH={pg_path}')
PY2
)" || fail "Les versions d’images déclarées dans .env sont invalides."

ALLOW_LATEST_IMAGES=""
POSTGRES_IMAGE=""
PYTHON_IMAGE=""
NODE_IMAGE=""
NGINX_IMAGE=""
POSTGRES_DATA_PATH=""
while IFS= read -r line; do
  case "$line" in
    ALLOW_LATEST_IMAGES=*) ALLOW_LATEST_IMAGES="${line#ALLOW_LATEST_IMAGES=}" ;;
    POSTGRES_IMAGE=*) POSTGRES_IMAGE="${line#POSTGRES_IMAGE=}" ;;
    PYTHON_IMAGE=*) PYTHON_IMAGE="${line#PYTHON_IMAGE=}" ;;
    NODE_IMAGE=*) NODE_IMAGE="${line#NODE_IMAGE=}" ;;
    NGINX_IMAGE=*) NGINX_IMAGE="${line#NGINX_IMAGE=}" ;;
    POSTGRES_DATA_PATH=*) POSTGRES_DATA_PATH="${line#POSTGRES_DATA_PATH=}" ;;
  esac
done <<< "$image_output"

if [[ "$ALLOW_LATEST_IMAGES" == "true" ]] && { [[ "$POSTGRES_IMAGE" == *":latest" ]] || [[ "$NGINX_IMAGE" == *":latest" ]] || [[ "$NODE_IMAGE" == *":latest" ]] || [[ "$PYTHON_IMAGE" == *":latest" ]]; }; then
  warn "Au moins une image utilise le tag latest ; la reproductibilité et les montées de version ne sont pas garanties."
fi

# Empêche une bascule silencieuse de PostgreSQL entre deux versions majeures.
if docker compose ps postgres --status running --quiet 2>/dev/null | grep -q .; then
  running_pg_major="$(docker compose exec -T postgres sh -c 'postgres --version' 2>/dev/null | sed -E 's/.* ([0-9]+)(\..*)?$/\1/' | tr -d '\r\n')"
  configured_pg_tag="${POSTGRES_IMAGE##*:}"
  configured_pg_major="${configured_pg_tag%%.*}"
  configured_pg_major="${configured_pg_major%%-*}"
  if [[ "$running_pg_major" =~ ^[0-9]+$ && "$configured_pg_major" =~ ^[0-9]+$ && "$running_pg_major" != "$configured_pg_major" ]]; then
    fail "PostgreSQL fonctionne actuellement en version majeure $running_pg_major mais POSTGRES_IMAGE cible $configured_pg_major. Utilise le script de migration PostgreSQL adapté."
  fi
fi

docker compose config >/dev/null || fail "La configuration Docker Compose est invalide."

ok "Docker et Docker Compose"
ok "Fichier .env valide — authentification $AUTH_MODE"
ok "Publication $GATEWAY_SCHEME sur le port $GATEWAY_PORT"
if [[ "$GATEWAY_SCHEME" == "https" ]]; then
  ok "Certificat $TLS_CERTIFICATE_FILE valide pour $PUBLIC_HOST"
  ok "Clé privée $TLS_PRIVATE_KEY_FILE correspondant au certificat"
else
  warn "Le mode HTTP ne chiffre pas les échanges. Il est réservé à un laboratoire ou à un frontal TLS externe."
fi
ok "Images : PostgreSQL $POSTGRES_IMAGE ; Python $PYTHON_IMAGE ; Node $NODE_IMAGE ; Nginx $NGINX_IMAGE"
ok "Configuration Docker Compose"
printf '\nLa configuration peut être construite et démarrée.\n'
