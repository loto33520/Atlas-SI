# Export visuel des cartographies

## Accès

Ouvrir une cartographie, puis utiliser le bouton **Exporter** dans la barre de commandes.

## PDF A3 paysage détaillé

Atlas SI génère un document multipage au format A3 paysage. Il est conçu pour une revue de cartographie, un dossier de sécurité, un atelier d’architecture ou un élément de preuve documentaire.

### Première page : vue cartographique

La première page contient :

- le logo configuré dans **Administration → Design et langues** ;
- le nom et le sous-titre de l’application ;
- le nom et la description de la carte enregistrée ;
- la date et l’heure de génération ;
- le nombre d’objets et de relations ;
- la cartographie complète ajustée à la zone disponible ;
- la légende des types d’objets ;
- la légende des types de relations avec leurs couleurs ;
- la mention de protection de la carte.

### Pages suivantes : inventaire des objets

L’inventaire des objets est paginé automatiquement et reprend :

- le nom et l’identifiant externe ;
- le type d’objet ;
- l’état et le niveau de protection ;
- la criticité ;
- le responsable ;
- la description ;
- les étiquettes ;
- les informations complémentaires.

### Pages suivantes : inventaire des relations

L’inventaire des relations reprend :

- la source et son type d’objet ;
- le type de relation et sa couleur ;
- la cible et son type d’objet ;
- le caractère orienté ou non orienté ;
- le libellé ;
- les informations complémentaires.

Le contenu correspond aux éléments réellement affichés dans la carte au moment de l’export. Pour un résultat documentaire stable, il est conseillé d’enregistrer préalablement un instantané avec la mention de protection appropriée.

## Image PNG haute définition

L’image PNG contient la totalité de la carte, y compris les éléments situés en dehors de la zone visible à l’écran. Elle convient notamment à une présentation ou à un document bureautique.

## Configuration JSON

Lorsqu’une carte enregistrée est ouverte, l’export JSON conserve ses paramètres : sélection, filtres, niveaux de granularité, regroupements, visibilité, protection et disposition.

Les instantanés peuvent également être exportés en CSV objets et relations via l’API existante.
