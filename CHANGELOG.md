# Journal des versions

## 2.2.0

- publication HTTP ou HTTPS sur un port configurable depuis `.env` ;
- contrôles conditionnels des certificats et cohérence de `PUBLIC_BASE_URL` ;
- guides Word complets d’installation, d’exploitation et d’administration ;
- documentation des emplacements de stockage et du modèle conceptuel de données ;
- correction de l’atténuation excessive des cartes imbriquées : la branche composée du nœud sélectionné reste lisible ;
- conservation de la couleur du type de relation sur les liens normaux, actifs et sélectionnés ;
- recherche dans la liste des types de relations du panneau Sélection ;
- suppression du raccourci redondant vers la bibliothèque depuis la cartographie ;
- consultation, modification du type, modification des attributs et archivage d’une relation directement depuis la carte ;
- export PDF A3 enrichi avec légendes des types d’objets et de relations, inventaire détaillé des objets et inventaire détaillé des relations ;
- ajout d’un test API de changement de type puis d’archivage d’une relation ;
- **47 tests API réussis**, compilation TypeScript stricte, construction Vite et test visuel Cytoscape validés.

## 2.1.0-rc4

- correction de la largeur héritée des cases à cocher dans les listes cartographiques ;
- noms des types d’objets de nouveau visibles, sans défilement horizontal ;
- recherche indépendante dans chaque niveau de granularité ;
- constructeur de cartes en pleine page depuis « Cartes enregistrées » ;
- parcours « configurer → enregistrer → visualiser », sans retirer le panneau de sélection de la carte ;
- configuration d’une carte existante depuis la bibliothèque ;
- choix explicite d’une carte existante à remplacer lors d’un enregistrement ;
- export direct en PDF A3 paysage avec identité visuelle, légende et mention de protection ;
- export PNG haute définition de la carte complète ;
- filtre des types d’objets actifs, archivés ou tous, avec actifs sélectionnés par défaut ;
- affichage du nombre d’objets actifs et total rattachés à chaque type ;
- maintien des niveaux vides par défaut, des regroupements par étiquette/information et de l’exploration imbriquée ;
- **46 tests API réussis**, compilation TypeScript stricte et construction Vite validées.

## 2.1.0-rc2

- listes de types d’objets et de relations affichées sur une seule colonne dans la sélection ;
- ajout d’un constructeur de niveaux de granularité paramétrables ;
- exploration cartographique imbriquée avec bulles repliables par double-clic ;
- prise en charge de plusieurs types d’objets par niveau ;
- conservation de la hiérarchie dans les cartes enregistrées dynamiques et instantanées ;
- page d’administration dédiée aux modèles ANSSI ;
- état d’installation par famille et réactivation des éléments standards archivés ;
- retrait transactionnel d’une famille ANSSI avec contrôle des objets, relations et contraintes ;
- conservation des composants partagés ou personnalisés ;
- 45 tests automatisés et validation fonctionnelle à 1 280 × 900 pixels.

## 2.1.0-rc1

- choix des familles lors de l’installation des modèles ANSSI ;
- catalogue ANSSI exposé par l’API avec état d’installation ;
- formulaire des objets responsive à partir des largeurs d’écran partagé ;
- correction des débordements des éditeurs clé/valeur ;
- renommage de « Périmètre » en « Sélection » ;
- recherche et sélection ergonomique des objets de départ ;
- exploration progressive de profondeur zéro, puis ouverture du voisinage par double-clic ;
- création rapide d’un objet depuis la carte avec activation facultative du glisser-déposer de relation ;
- regroupement visuel par type, étiquette ou information complémentaire ;
- bibliothèque distincte des cartes enregistrées ;
- chargement d’une carte enregistrée par URL, mise à jour de la carte active et enregistrement sous un nouveau nom ;
- adaptation de la barre de commandes cartographiques aux fenêtres de 1 280 pixels ;
- 42 tests automatisés.

## 2.0.0

- administration modulaire des fonctionnalités ;
- niveau de maturité associé à chaque module ;
- profondeur de récursivité configurable dans la cartographie ;
- sélection dynamique des types d’objets et de relations ;
- sélection d’un ou plusieurs objets de départ ;
- sens de parcours amont, aval ou bidirectionnel ;
- cartes dynamiques et instantanés enregistrés ;
- partage des cartes par utilisateur, tous les utilisateurs ou groupes Keycloak ;
- exports JSON et CSV ;
- modèles ANSSI optionnels ;
- champs de gouvernance et de revue sur les objets ;
- contrôles qualité des validations et échéances de revue ;
- migration `0008_v2_modules_maps_governance` ;
- 41 tests automatisés.

## 1.0.4

- versions des images Docker configurables ;
- prise en charge contrôlée des tags flottants ;
- scripts d’affichage des versions et de migration PostgreSQL 17 vers 18.
