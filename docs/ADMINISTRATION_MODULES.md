# Administration des fonctionnalités

## Principe

Atlas SI conserve un référentiel central unique. L’activation ou la désactivation d’un module ne crée pas un nouveau référentiel et ne supprime aucune donnée.

## Modules disponibles

- Cartographie interactive ;
- Cartes enregistrées ;
- Analyse d’impact ;
- Versions et obsolescence ;
- Versions dans la fiche cartographique ;
- Imports CSV et JSON ;
- Qualité et audit de complétude ;
- Gouvernance et revues ;
- Historique détaillé ;
- Modèles ANSSI.

## Dépendances

Les dépendances sont ajoutées automatiquement. Par exemple :

- Cartes enregistrées nécessite Cartographie ;
- Versions dans la fiche cartographique nécessite Cartographie et Versions ;
- Gouvernance et revues nécessite Qualité.

## Profils conseillés

### Découverte

```text
Cartographie interactive
```

### Exploitation courante

```text
Cartographie interactive
Cartes enregistrées
Analyse d’impact
Imports
Qualité
```

### Gouvernance complète

Tous les modules activés.

## Administration des modèles ANSSI

Lorsque le module **Modèles ANSSI** est activé, une page distincte apparaît dans l’administration.

Chaque famille peut être :

- installée lorsque ses éléments sont absents ;
- complétée lorsqu’elle n’est que partiellement installée ;
- retirée en sécurité lorsqu’aucun élément standard n’est utilisé.

Le retrait est transactionnel. Atlas SI vérifie les objets, les relations et les contraintes de types avant toute modification. Si un seul élément est utilisé, aucun élément de la famille n’est retiré. Les composants partagés avec une autre famille installée et les composants personnalisés sont conservés.
