from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.local_auth import hash_password
from app.features import get_feature_settings
from app.models import LocalUser, ObjectType, RelationType

settings = get_settings()

OBJECT_TYPES = [
    {"code": "process", "name": "Processus", "icon": "workflow", "color": "#7C3AED"},
    {"code": "application", "name": "Application", "icon": "app-window", "color": "#2563EB"},
    {"code": "server", "name": "Serveur", "icon": "server", "color": "#0891B2"},
    {"code": "database", "name": "Base de données", "icon": "database", "color": "#0D9488"},
    {"code": "software", "name": "Logiciel", "icon": "package", "color": "#EA580C"},
    {"code": "network", "name": "Équipement réseau", "icon": "network", "color": "#4F46E5"},
    {"code": "data", "name": "Donnée", "icon": "files", "color": "#DB2777"},
    {"code": "site", "name": "Site", "icon": "building", "color": "#475569"},
]

RELATION_TYPES = [
    {"code": "supports", "name": "Soutient", "color": "#7C3AED", "directed": True},
    {"code": "depends_on", "name": "Dépend de", "color": "#DC2626", "directed": True},
    {"code": "hosted_on", "name": "Hébergé sur", "color": "#0891B2", "directed": True},
    {"code": "installed_on", "name": "Installé sur", "color": "#EA580C", "directed": True},
    {"code": "communicates_with", "name": "Communique avec", "color": "#2563EB", "directed": True},
    {"code": "stores", "name": "Stocke", "color": "#0D9488", "directed": True},
    {"code": "uses", "name": "Utilise", "color": "#4F46E5", "directed": True},
    {"code": "located_in", "name": "Situé dans", "color": "#475569", "directed": True},
]


def seed_local_admin(db) -> None:
    if settings.auth_mode != "local":
        return

    username = settings.local_admin_username
    user = db.scalar(select(LocalUser).where(LocalUser.username == username))
    roles = ["admin", "contributor", "auditor", "reader"]
    if user is None:
        db.add(
            LocalUser(
                username=username,
                password_hash=hash_password(settings.local_admin_password),
                display_name=settings.local_admin_display_name.strip() or username,
                email=settings.local_admin_email.strip() or None,
                app_roles=roles,
                active=True,
            )
        )
        return

    user.display_name = settings.local_admin_display_name.strip() or username
    user.email = settings.local_admin_email.strip() or None
    user.app_roles = roles
    user.active = True
    if settings.local_admin_reset_password:
        user.password_hash = hash_password(settings.local_admin_password)


def run() -> None:
    with SessionLocal() as db:
        existing_types = set(db.scalars(select(ObjectType.code)).all())
        for values in OBJECT_TYPES:
            if values["code"] not in existing_types:
                db.add(ObjectType(**values, description=None, schema={}, active=True))
        db.flush()

        existing_relations = set(db.scalars(select(RelationType.code)).all())
        for values in RELATION_TYPES:
            if values["code"] not in existing_relations:
                db.add(RelationType(**values, description=None, active=True))

        seed_local_admin(db)
        get_feature_settings(db, settings.feature_profile)
        db.commit()


if __name__ == "__main__":
    run()
