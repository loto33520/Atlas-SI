# Stockage, sauvegarde et restauration

## Emplacements sur l’hôte

| Emplacement | Contenu | Sauvegarde requise |
|---|---|---|
| `/opt/atlas-si/.env` | secrets, URL, port, authentification | oui, chiffrée |
| `/opt/atlas-si/certs/` | certificat et clé privée HTTPS | oui, chiffrée |
| `/opt/atlas-si/backups/` | sauvegardes PostgreSQL produites par le script | oui, externaliser |
| `/opt/atlas-si/` | code, Compose, scripts et documentation | archive de version suffisante |

## Données persistantes Docker

La base PostgreSQL est conservée dans le volume nommé `atlas_postgres_data` par défaut. Son nom est configurable avec `POSTGRES_VOLUME_NAME`. Avec PostgreSQL 18, le volume est monté sur `/var/lib/postgresql` dans le conteneur.

Toutes les données fonctionnelles sont en base : objets, relations, types, cartes enregistrées, positions, réglages de design, logo encodé, historique d’audit, imports analysés, scénarios d’impact, versions et connecteurs.

## Éléments non persistants

- frontend compilé : intégré à l’image `gateway`, dans `/usr/share/nginx/html` ;
- configuration Nginx générée : `/etc/nginx/conf.d/default.conf`, recréée au démarrage ;
- journaux : sortie standard des conteneurs, consultable avec `docker compose logs` ;
- fichiers CSV/JSON importés : leur contenu utile et le résultat d’analyse sont enregistrés en base, le fichier source n’est pas conservé comme pièce jointe.

## Sauvegarde

```bash
cd /opt/atlas-si
sudo ./scripts/backup.sh
sudo ls -lh backups/
```

Le script crée un dump PostgreSQL au format personnalisé, applique des permissions restrictives et supprime les sauvegardes locales dépassant la rétention.

## Restauration

```bash
sudo ./scripts/restore.sh /chemin/atlas-AAAAMMJJ-HHMMSS.dump
```

La restauration remplace intégralement la base après confirmation explicite. Tester périodiquement la procédure sur un environnement isolé.
