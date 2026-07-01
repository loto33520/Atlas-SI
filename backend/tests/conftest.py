import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

# Les tests doivent être totalement isolés de la configuration de production
# transmise au conteneur par env_file. On écrase donc explicitement les valeurs
# nécessaires avant le premier import de l’application.
TEST_ENV = {
    "APP_ENV": "test",
    "APP_NAME": "Atlas SI Tests",
    "APP_VERSION": "test",
    "APP_SECRET_KEY": "test-secret-key-test-secret-key-123456",
    "DATABASE_URL": "sqlite+pysqlite:///./atlas_test.db",
    "AUTH_MODE": "keycloak",
    "OIDC_ISSUER_URL": "https://sso.example.test/realms/test",
    "OIDC_CLIENT_ID": "carto-app",
    "OIDC_CLIENT_SECRET": "test-client-secret",
    "OIDC_SCOPES": "openid profile email",
    "PUBLIC_BASE_URL": "https://carto.example.org",
    "TRUSTED_HOSTS": "carto.example.org,testserver,localhost,127.0.0.1",
    "COOKIE_SECURE": "false",
    "AUTH_ADMIN_VALUES": "ATLAS-ADMINISTRATEURS,/ATLAS-ADMINISTRATEURS",
    "AUTH_CONTRIBUTOR_VALUES": "ATLAS-CONTRIBUTEURS,/ATLAS-CONTRIBUTEURS",
    "AUTH_AUDITOR_VALUES": "ATLAS-AUDITEURS,/ATLAS-AUDITEURS",
    "AUTH_READER_VALUES": "ATLAS-LECTEURS,/ATLAS-LECTEURS",
    "ALLOW_AUTHENTICATED_READ": "true",
}
for key, value in TEST_ENV.items():
    os.environ[key] = value


import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.security import AuthContext, get_auth_context

engine = create_engine(
    "sqlite+pysqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session() -> Session:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def admin_context() -> AuthContext:
    return AuthContext(
        session_id="test-session",
        subject="user-1",
        username="admin",
        email="admin@example.com",
        display_name="Administrateur",
        roles=("admin", "contributor", "auditor", "reader"),
        groups=("ATLAS-ADMINISTRATEURS",),
        csrf_token="csrf-test",
    )


@pytest.fixture
def client(admin_context: AuthContext):
    def override_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_auth():
        return admin_context

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_auth_context] = override_auth
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
