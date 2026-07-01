#!/bin/sh
set -eu

scheme="${GATEWAY_SCHEME:-https}"
port="${GATEWAY_PORT:-443}"
case "$scheme" in
  http|https) ;;
  *) echo "ERREUR : GATEWAY_SCHEME doit valoir http ou https." >&2; exit 1 ;;
esac
case "$port" in
  ''|*[!0-9]*) echo "ERREUR : GATEWAY_PORT doit être un entier." >&2; exit 1 ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "ERREUR : GATEWAY_PORT doit être compris entre 1 et 65535." >&2
  exit 1
fi

: "${PUBLIC_HOST:?PUBLIC_HOST doit être renseigné}"
if [ "$scheme" = "https" ]; then
  : "${TLS_CERTIFICATE_FILE:?TLS_CERTIFICATE_FILE doit être renseigné en HTTPS}"
  : "${TLS_PRIVATE_KEY_FILE:?TLS_PRIVATE_KEY_FILE doit être renseigné en HTTPS}"
  template=/etc/nginx/atlas-templates/https.conf.template
else
  template=/etc/nginx/atlas-templates/http.conf.template
fi

envsubst '${PUBLIC_HOST} ${GATEWAY_PORT} ${TLS_CERTIFICATE_FILE} ${TLS_PRIVATE_KEY_FILE}' \
  < "$template" > /etc/nginx/conf.d/default.conf

echo "Atlas SI : passerelle ${scheme} sur le port ${port}."
