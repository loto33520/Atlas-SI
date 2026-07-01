# Validation — Atlas SI 2.2.0

## Tests applicatifs

- 47 tests API réussis avec Pytest ;
- compilation Python et chargement des migrations ;
- installation npm propre depuis le registre public ;
- compilation TypeScript stricte ;
- construction Vite de production.

## Tests de publication

- contrôle `.env` en HTTP sur le port 8080 sans certificat ;
- contrôle `.env` en HTTPS sur le port 443 avec certificat auto-signé de test ;
- validation des modèles Nginx HTTP et HTTPS avec `nginx -t` ;
- contrôle d’un port HTTPS personnalisé 8443 ;
- rejet des incohérences de protocole, de port et de cookie sécurisé ;
- absence d’adresse de dépôt npm interne dans le verrou.

## Limite du laboratoire

Docker Engine n’est pas disponible dans l’environnement de fabrication du paquet. Le cycle complet `docker compose build/up` doit donc être confirmé sur le serveur cible. Les sources, les scripts, les configurations Nginx, la compilation frontend et les tests API ont été validés séparément.
