SHELL := /bin/bash

.PHONY: check build up down restart logs status migrate seed test backup

check:
	./scripts/check-config.sh

build:
	docker compose build --pull

up:
	docker compose up -d

restart:
	docker compose restart

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

status:
	docker compose ps

migrate:
	docker compose exec api alembic upgrade head

seed:
	docker compose exec api python -m app.seed

test:
	docker compose exec -T api python -m pytest -q

backup:
	./scripts/backup.sh
