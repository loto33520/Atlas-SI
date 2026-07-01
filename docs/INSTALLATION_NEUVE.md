# Installation neuve — Atlas SI 2.2.0

## 1. Prérequis

- serveur Linux 64 bits ;
- Docker Engine et module Docker Compose ;
- accès aux registres d’images et à `registry.npmjs.org` pendant la construction ;
- nom DNS recommandé en production ;
- certificat PEM uniquement si `GATEWAY_SCHEME=https` ;
- 2 vCPU, 4 Go de mémoire et 20 Go de disque au minimum pour un laboratoire ;
- sauvegarde externe prévue pour les exports PostgreSQL.

## 2. Extraire l’archive

```bash
sudo mkdir -p /opt/atlas-si
sudo tar -xzf atlas-si-v2.2.0-installation-neuve.tar.gz \
  -C /opt/atlas-si --strip-components=1
cd /opt/atlas-si
sudo chown -R root:root /opt/atlas-si
```

## 3. Préparer le fichier `.env`

Assistant interactif :

```bash
sudo ./scripts/prepare-install.sh local
# ou
sudo ./scripts/prepare-install.sh keycloak
```

Le protocole et le port sont pilotés dans `.env`.

### HTTPS standard

```dotenv
GATEWAY_SCHEME=https
GATEWAY_PORT=443
PUBLIC_BASE_URL=https://carto.example.org
PUBLIC_HOST=carto.example.org
COOKIE_SECURE=true
TLS_CERTIFICATE_FILE=atlas-si.fullchain.pem
TLS_PRIVATE_KEY_FILE=atlas-si.key
```

### HTTPS sur un port personnalisé

```dotenv
GATEWAY_SCHEME=https
GATEWAY_PORT=8443
PUBLIC_BASE_URL=https://carto.example.org:8443
PUBLIC_HOST=carto.example.org
COOKIE_SECURE=true
```

### Laboratoire HTTP sans certificat

```dotenv
GATEWAY_SCHEME=http
GATEWAY_PORT=8080
PUBLIC_BASE_URL=http://serveur-lab.example.org:8080
PUBLIC_HOST=serveur-lab.example.org
TRUSTED_HOSTS=serveur-lab.example.org
COOKIE_SECURE=false
TLS_CERTIFICATE_FILE=
TLS_PRIVATE_KEY_FILE=
```

Le mode HTTP ne chiffre pas les mots de passe ni les données. Il doit être limité à un réseau de laboratoire isolé ou être placé derrière un frontal qui termine le TLS.

## 4. Certificats HTTPS

En HTTPS, déposer le certificat et la clé privée dans `/opt/atlas-si/certs/`, puis appliquer les permissions décrites dans `certs/README.md`.

## 5. Contrôler et démarrer

```bash
cd /opt/atlas-si
sudo ./scripts/check-config.sh
sudo docker compose build --pull
sudo docker compose up -d
sudo docker compose ps
sudo ./scripts/diagnose.sh
```

La passerelle n’expose qu’un seul port, défini par `GATEWAY_PORT`. Nginx écoute le même port dans le conteneur et publie soit du HTTP, soit du HTTPS selon `GATEWAY_SCHEME`.

## 6. Première connexion

- mode local : compte défini par `LOCAL_ADMIN_USERNAME` et `LOCAL_ADMIN_PASSWORD` ;
- mode Keycloak : client confidentiel avec URL de redirection `${PUBLIC_BASE_URL}/api/auth/callback`.

## 7. Contrôles après installation

```bash
sudo docker compose exec api alembic current
sudo ./scripts/run-tests.sh
sudo ./scripts/backup.sh
```

Résultats attendus : migration `0008_v2_modules_maps_governance (head)`, 47 tests API réussis et trois services sains.
