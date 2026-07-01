# Publication HTTP, HTTPS et ports personnalisés

Atlas SI 2.2.0 utilise quatre variables cohérentes :

| Variable | Rôle |
|---|---|
| `GATEWAY_SCHEME` | `http` ou `https` |
| `GATEWAY_PORT` | port publié sur l’hôte et écouté par Nginx |
| `PUBLIC_BASE_URL` | URL complète vue par les utilisateurs |
| `COOKIE_SECURE` | `true` en HTTPS, `false` en HTTP |

En HTTPS, `TLS_CERTIFICATE_FILE` et `TLS_PRIVATE_KEY_FILE` sont obligatoires. En HTTP, ils peuvent être vides. `scripts/check-config.sh` bloque les incohérences de protocole, de port, de cookie ou de certificat.

Exemples :

```dotenv
# Production
GATEWAY_SCHEME=https
GATEWAY_PORT=443
PUBLIC_BASE_URL=https://carto.example.org
COOKIE_SECURE=true

# Recette TLS
GATEWAY_SCHEME=https
GATEWAY_PORT=8443
PUBLIC_BASE_URL=https://carto.example.org:8443
COOKIE_SECURE=true

# Laboratoire
GATEWAY_SCHEME=http
GATEWAY_PORT=8080
PUBLIC_BASE_URL=http://lab.example.org:8080
COOKIE_SECURE=false
```
