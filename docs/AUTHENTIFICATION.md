# Authentification — Atlas SI 2.2.0

## Mode local

Le compte initial est configuré dans `.env`. Le mot de passe doit contenir au moins 12 caractères. Les tentatives sont limitées par fenêtre temporelle. Pour réaligner le mot de passe stocké, passer temporairement `LOCAL_ADMIN_RESET_PASSWORD=true`, redémarrer l’API, puis remettre `false`.

## Mode Keycloak

Configurer un client confidentiel OpenID Connect :

- URL de redirection : `${PUBLIC_BASE_URL}/api/auth/callback` ;
- origine Web : valeur de `PUBLIC_BASE_URL` ;
- groupes ou rôles associés aux variables `AUTH_*_VALUES`.

Rôles applicatifs : administrateur, contributeur, auditeur et lecteur.

## HTTP et sécurité

`COOKIE_SECURE` doit valoir `true` en HTTPS et `false` en HTTP. Le mode HTTP expose les identifiants et les données en clair : il est réservé à un laboratoire isolé ou à un déploiement derrière un frontal TLS de confiance.
