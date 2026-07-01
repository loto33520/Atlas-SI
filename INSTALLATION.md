# Installation Atlas SI 2.2.0

La procédure détaillée est disponible dans :

- `docs/INSTALLATION_NEUVE.md` ;
- `docs/Atlas_SI_2.2_Guide_Installation_Exploitation.docx`.

Démarrage rapide :

```bash
sudo mkdir -p /opt/atlas-si
sudo tar -xzf atlas-si-v2.2.0-installation-neuve.tar.gz -C /opt/atlas-si --strip-components=1
cd /opt/atlas-si
sudo ./scripts/prepare-install.sh local   # ou keycloak
sudo ./scripts/check-config.sh
sudo docker compose build --pull
sudo docker compose up -d
```
