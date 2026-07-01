# Atlas SI 2.2.0

La version 2.2.0 consolide les évolutions cartographiques préparées dans les versions candidates 2.1 et ajoute une publication Web entièrement configurable depuis `.env`.

## Cartographie

- panneau de sélection lisible sur une seule colonne ;
- recherche dans les types d’objets, les types de relations et chaque niveau ;
- exploration progressive ou imbriquée ;
- niveaux vides par défaut, librement paramétrables ;
- regroupement par type, étiquette ou information complémentaire ;
- maintien de la lisibilité des conteneurs et descendants lors d’une sélection ;
- création rapide d’un objet et création de relation par glisser-déposer ;
- édition et archivage d’une relation depuis son volet ;
- couleurs de relations respectées sur les liens et lors de la sélection.

## Cartes enregistrées et exports

- constructeur pleine page ;
- cartes dynamiques ou instantanés ;
- possibilité de remplacer explicitement une carte existante ;
- export PDF A3 multipage avec vue, légendes, inventaire des objets et des relations ;
- export PNG haute définition et configuration JSON.

## Administration

- page dédiée aux modèles ANSSI ;
- retrait transactionnel uniquement si les éléments ne sont pas utilisés ;
- filtres actifs, archivés ou tous sur les types d’objets ;
- comptage des objets rattachés ;
- formulaires responsive, y compris gouvernance, étiquettes et informations complémentaires.

## Déploiement

Les variables suivantes permettent de choisir le protocole et le port :

```dotenv
GATEWAY_SCHEME=https
GATEWAY_PORT=443
```

Le mode HTTP sans certificat est disponible pour un laboratoire. Le contrôle de configuration vérifie la cohérence entre le protocole, le port, `PUBLIC_BASE_URL`, les cookies et les certificats.

Aucune nouvelle migration de base de données n’est nécessaire par rapport au schéma `0008`.
