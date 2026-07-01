# Ergonomie de la cartographie — version 2.1

## Organisation générale

La cartographie distingue quatre usages :

1. **Sélection** : définir les objets de départ, les types autorisés et le mode d’exploration ;
2. **Filtres** : limiter les objets par criticité ou étiquettes ;
3. **Regrouper** : mettre temporairement en évidence une famille d’objets ;
4. **Cartes enregistrées** : conserver et retrouver une vue réutilisable.

## Sélection

Le bouton **Sélection** ouvre un panneau contenant :

- une recherche dans les objets actifs ;
- des cases à cocher pour choisir un ou plusieurs objets de départ ;
- le sens de parcours amont, aval ou bidirectionnel ;
- une profondeur de 0 à 10 niveaux pour les cartes classiques ;
- les types d’objets et de relations autorisés.

Les listes de types sont affichées sur une seule colonne. Les cases à cocher ont une largeur fixe, aucun défilement horizontal n’est créé et les intitulés restent visibles sur une ligne. Chaque niveau de granularité possède sa propre recherche. La liste des types de relations dispose également d’une recherche dédiée.

Sans objet de départ, la carte affiche tous les objets correspondant aux critères.

## Exploration progressive simple

Le mode **Exploration progressive simple** force une profondeur initiale de zéro. Un double-clic sur un objet charge son voisinage immédiat sans créer de conteneur visuel.

Ce mode convient à une exploration libre du graphe, sans imposer un ordre entre les types d’objets.

## Exploration imbriquée

Le mode **Exploration imbriquée** construit une carte par niveaux de granularité. Une nouvelle configuration contient deux niveaux vides : aucun type n’est présélectionné. Chaque niveau possède :

- un nom libre ;
- un ordre ;
- un ou plusieurs types d’objets ;
- un regroupement visuel facultatif par étiquette ou information complémentaire.

Un type d’objet ne peut appartenir qu’à un seul niveau de la même carte. Les intitulés des types restent affichés à côté de leur case et les types retenus sont rappelés sous forme d’étiquettes.

Le premier niveau est affiché à l’ouverture. Un double-clic sur un objet charge uniquement les objets du niveau suivant qui lui sont reliés et ouvre une bulle autour d’eux. Un nouveau double-clic replie la bulle et tous ses descendants. Le double-clic n’ouvre pas le volet de détails ; un clic simple reste dédié à la consultation de ce volet. L’ancienne infobulle au survol a été supprimée.

Exemple :

```text
Niveau 1 — Sites
Niveau 2 — Équipements réseau et serveurs
Niveau 3 — Applications et logiciels
Niveau 4 — Données et bases de données
```

Le sens de parcours et les types de relations sélectionnés restent applicables entre deux niveaux. Le résultat dépend donc des relations réellement présentes dans le référentiel.

### Regroupement d’un niveau par donnée

Chaque niveau peut être affiché sans regroupement ou être séparé :

- par une clé d’étiquette ;
- par une information complémentaire.

La clé peut être choisie dans les suggestions ou saisie librement. Atlas SI crée une bulle par valeur rencontrée et place les objets sans valeur dans **Non renseigné**.

Exemple :

```text
Niveau 1 — Site
Niveau 2 — Serveur + Équipement réseau
Regroupement du niveau 2 — étiquette network
```

L’ouverture d’un site peut alors produire les bulles `network : LAN`, `network : DMZ` et `network : VOIP`. Les objets contenus restent explorables et peuvent ouvrir le niveau suivant.

## Enregistrement des niveaux

La configuration d’exploration imbriquée est enregistrée avec la carte :

- une carte **dynamique** se rouvre sur son premier niveau et recalcule les objets à chaque ouverture ;
- un **instantané** conserve le graphe ainsi que l’état ouvert ou replié des bulles.

Les noms, l’ordre, les types et les regroupements de chaque niveau sont conservés lors d’une mise à jour de la carte active ou d’un enregistrement sous un nouveau nom. Les cartes créées avec la rc2 restent lisibles et utilisent automatiquement « Aucun regroupement ».

## Création rapide

Le bouton **Objet** ouvre un formulaire réduit contenant :

- le type ;
- le nom ;
- la criticité ;
- le responsable ;
- la description ;
- les étiquettes ;
- les champs configurés dans le schéma du type.

Après création, l’objet est immédiatement ajouté à la carte. L’option **Créer puis relier** active automatiquement le mode de liaison par glisser-déposer.

## Regroupements de lecture

Le panneau **Regrouper** calcule les familles à partir des objets actuellement affichés. Les critères disponibles sont :

- le type d’objet ;
- une clé d’étiquette ;
- une information complémentaire.

Le choix d’une valeur met en évidence les objets correspondants et atténue les autres. Cette action ne modifie ni le référentiel ni la définition de la carte enregistrée. Dans une carte imbriquée, la sélection conserve toujours les conteneurs de la branche active : un parent atténué ne peut donc plus rendre ses sous-éléments presque invisibles.

## Relations dans la cartographie

La couleur configurée dans **Administration → Types de relations** est utilisée sur le lien au repos, lors de sa mise en évidence et lors de sa sélection.

Un clic sur une relation ouvre son volet de détail. Pour un contributeur ou un administrateur, ce volet permet de :

- modifier le type de relation parmi les types compatibles avec les deux objets ;
- modifier le libellé ;
- modifier les informations complémentaires ;
- supprimer la relation de la carte.

La suppression archive la relation dans le référentiel après confirmation ; elle ne réalise pas une suppression physique non tracée.

## Cartes enregistrées

La bibliothèque **Cartes enregistrées** permet :

- la recherche par nom, description ou propriétaire ;
- le filtrage entre cartes dynamiques et instantanés ;
- l’ouverture d’une carte ;
- la modification de son nom, de sa description, de sa visibilité et de sa protection ;
- son archivage.

La bibliothèque propose un constructeur pleine page pour préparer, enregistrer puis visualiser une carte. Dans la cartographie :

- **Enregistrer** crée une carte ou remplace explicitement une carte choisie ;
- **Mettre à jour** remplace les paramètres et la disposition de la carte active ;
- **Enregistrer sous** peut créer une nouvelle carte ou sélectionner une carte existante à remplacer ;
- **Exporter** génère un PDF A3 paysage multipage avec inventaires détaillés, un PNG haute définition ou la configuration JSON.

## Limites connues

Les bulles sont calculées à partir des relations du référentiel et des types associés aux niveaux. Elles ne créent aucune relation implicite. Un objet déjà placé dans une branche n’est pas dupliqué automatiquement dans une seconde branche de la même vue.
