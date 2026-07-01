# Versions des images Docker — Atlas SI 2.2.0

Les images sont configurables dans `.env`. Les valeurs par défaut ont été retenues pour la version 2.2.0 :

```dotenv
POSTGRES_IMAGE=postgres:18.4-alpine3.23
POSTGRES_DATA_PATH=/var/lib/postgresql
POSTGRES_VOLUME_NAME=atlas_postgres_data
PYTHON_IMAGE=python:3.13.14-slim-trixie
NODE_IMAGE=node:24.18.0-alpine3.23
NGINX_IMAGE=nginx:1.30.3-alpine3.23
ALLOW_LATEST_IMAGES=false
```

Les tags flottants sont acceptés uniquement lorsque `ALLOW_LATEST_IMAGES=true`, mais ils sont déconseillés en production. Une montée majeure PostgreSQL doit être effectuée avec le script de migration prévu, jamais par simple changement du tag sur un volume existant.
