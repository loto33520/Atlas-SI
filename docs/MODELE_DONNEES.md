# Modèle de données

Le modèle principal est relationnel, avec des colonnes JSONB pour les attributs configurables, les étiquettes, les filtres et les instantanés cartographiques.

Entités centrales :

- `object_types` définit les catégories et leurs champs dynamiques ;
- `si_objects` contient les objets du SI ;
- `relation_types` définit les liens autorisés, leur sens et leur couleur ;
- `si_relations` relie une source et une cible ;
- `saved_maps` conserve les requêtes, filtres, positions et instantanés ;
- `audit_events` trace les opérations ;
- `design_settings` et `feature_settings` centralisent la configuration ;
- les tables d’import, d’impact, de versions et de connecteurs complètent le référentiel.

Le schéma illustré complet est inclus dans le guide Word d’administration.
