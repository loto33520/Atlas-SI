# Contribuer à Atlas SI

Merci de votre intérêt pour Atlas SI.

## Avant de commencer

- recherchez si un ticket similaire existe déjà ;
- ouvrez un ticket pour décrire les changements fonctionnels importants ;
- ne joignez aucune donnée réelle ou confidentielle ;
- conservez les libellés de l’interface en français clair et évitez les anglicismes inutiles.

## Développement

### API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
```

### Interface

```bash
cd frontend
npm ci
npm run build
```

### Vérification générale

```bash
./scripts/check-config.sh
./scripts/run-tests.sh
```

## Demandes de fusion

Une demande de fusion doit :

- expliquer le problème traité ;
- décrire la solution retenue ;
- indiquer les tests réalisés ;
- préserver les fonctions existantes ;
- mettre à jour la documentation lorsque nécessaire ;
- ne contenir aucun secret, certificat, export réel ou adresse de dépôt interne.

En proposant une contribution, vous acceptez qu’elle soit distribuée sous la licence GNU Affero General Public License v3.0 du projet.
