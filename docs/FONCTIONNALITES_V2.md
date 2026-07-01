# Fonctionnalités de la version 2

## Profil modulaire

Les fonctions optionnelles sont activables indépendamment depuis l’administration. Chaque carte présente :

- une description ;
- ses dépendances ;
- son niveau de maturité ;
- un interrupteur d’activation.

### Niveaux de maturité

| Niveau | Signification |
|---|---|
| M1 | Inventaire et visibilité essentiels |
| M2 | Maîtrise des dépendances, du cycle de vie et de la qualité |
| M3 | Gouvernance, validation et revues régulières |

## Cartographie avancée

La carte peut être construite à partir :

- de zéro, un ou plusieurs objets de départ ;
- de tous les types d’objets actifs ou d’une sélection ;
- de tous les types de relations actifs ou d’une sélection ;
- d’un sens amont, aval ou bidirectionnel ;
- d’une profondeur de 0 à 10 niveaux ;
- de filtres par texte, criticité et étiquettes.

La liste des types est toujours issue de l’administration. Aucun type métier n’est imposé par le code.

## Cartes enregistrées

Une carte dynamique conserve la requête et se recalcule à chaque ouverture. Un instantané conserve le résultat figé.

Visibilités disponibles :

- privée ;
- tous les utilisateurs ;
- groupes Keycloak.

Les positions, la disposition, la profondeur, les filtres et la mention de protection sont mémorisés.

## Modèles ANSSI

L’installation optionnelle ajoute des types pour :

- l’écosystème ;
- l’administration privilégiée ;
- l’infrastructure logique ;
- l’infrastructure physique ;
- les profils utilisateurs.

L’opération est idempotente et ne remplace jamais les types déjà présents. Une page dédiée indique l’état de chaque famille et permet de retirer les éléments standards inutilisés. Le retrait est transactionnel : si un seul composant est utilisé, aucune modification n’est appliquée.

## Gouvernance

Chaque objet peut porter :

- un responsable de la donnée ;
- un statut brouillon, validé ou à revoir ;
- un niveau de confiance ;
- une dernière et une prochaine date de revue ;
- une fréquence de revue ;
- une mention de protection.

## Évolutions ergonomiques 2.2

### Administration dédiée des modèles ANSSI

L’administrateur installe uniquement les familles utiles depuis une page distincte. Le catalogue indique l’état de chaque famille. Les familles inutilisées peuvent être retirées après contrôle de tous les objets, relations et contraintes. Les composants partagés ou personnalisés sont conservés.

### Référentiel responsive

Le formulaire des objets s’adapte aux fenêtres étroites. Les champs de gouvernance passent automatiquement sur plusieurs lignes et les éditeurs clé/valeur occupent toute la largeur disponible.

### Exploration et regroupements

La cartographie propose :

- une sélection recherchable des objets de départ ;
- des listes de types sans défilement horizontal et une recherche indépendante dans chaque niveau ;
- un mode progressif simple démarrant à profondeur zéro ;
- un mode imbriqué avec niveaux de granularité paramétrables ;
- l’ouverture et le repli de bulles par double-clic ;
- la création rapide d’un objet ;
- le passage direct au glisser-déposer de relation ;
- une mise en évidence par type, étiquette ou information complémentaire ;
- un constructeur en pleine page depuis la bibliothèque des cartes enregistrées ;
- le remplacement explicite d’une carte existante lors de l’enregistrement ;
- un export PDF A3 paysage multipage reprenant l’identité visuelle, les légendes et les inventaires détaillés, un export PNG haute définition et l’export JSON de la configuration.

La liste des types d’objets est filtrée sur les types actifs par défaut. L’administrateur peut afficher les types archivés ou tous les types, avec le nombre d’objets actifs et total rattachés à chaque type.

Consulter `ERGONOMIE_CARTOGRAPHIE.md`, `CONSTRUCTEUR_CARTES.md` et `EXPORT_CARTOGRAPHIE.md` pour le fonctionnement détaillé.
