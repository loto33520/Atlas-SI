# Certificats HTTPS

Ce répertoire n'est utilisé que lorsque le fichier `.env` contient :

```dotenv
GATEWAY_SCHEME=https
```

Les noms des fichiers sont configurés dans `.env` :

```dotenv
TLS_CERTIFICATE_FILE=atlas-si.fullchain.pem
TLS_PRIVATE_KEY_FILE=atlas-si.key
```

Déposer ici :

- le certificat du serveur avec sa chaîne intermédiaire complète ;
- la clé privée correspondante, sans phrase secrète.

Permissions conseillées :

```bash
chown root:root certs/atlas-si.fullchain.pem certs/atlas-si.key
chmod 644 certs/atlas-si.fullchain.pem
chmod 600 certs/atlas-si.key
```

Pour un laboratoire HTTP sans certificat, utiliser par exemple :

```dotenv
GATEWAY_SCHEME=http
GATEWAY_PORT=8080
PUBLIC_BASE_URL=http://serveur-lab.example.org:8080
COOKIE_SECURE=false
TLS_CERTIFICATE_FILE=
TLS_PRIVATE_KEY_FILE=
```

Les noms de fichiers doivent être simples, sans `/` ni `..`. Ne jamais ajouter une clé privée dans Git.
