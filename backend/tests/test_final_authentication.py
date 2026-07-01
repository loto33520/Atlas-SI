from app.local_auth import hash_password, verify_password
from app.models import LocalUser
from app.routers import auth as auth_router


def test_password_hash_roundtrip():
    encoded = hash_password("UnePhraseDePasseSolide!2026")
    assert encoded.startswith("scrypt$")
    assert verify_password("UnePhraseDePasseSolide!2026", encoded)
    assert not verify_password("mauvais-mot-de-passe", encoded)


def test_auth_config_keycloak_by_default(client):
    auth_router.settings.auth_mode = "keycloak"
    response = client.get("/api/auth/config")
    assert response.status_code == 200
    assert response.json() == {"mode": "keycloak", "local_username_hint": None}


def test_local_login_creates_server_session(client, db_session):
    previous_mode = auth_router.settings.auth_mode
    previous_username = auth_router.settings.local_admin_username
    auth_router.settings.auth_mode = "local"
    auth_router.settings.local_admin_username = "admin"
    try:
        user = LocalUser(
            username="admin",
            password_hash=hash_password("UnePhraseDePasseSolide!2026"),
            display_name="Administrateur",
            email="admin@example.com",
            app_roles=["admin", "contributor", "auditor", "reader"],
            active=True,
        )
        db_session.add(user)
        db_session.commit()

        response = client.post(
            "/api/auth/local/login",
            json={"username": "ADMIN", "password": "UnePhraseDePasseSolide!2026"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["username"] == "admin"
        assert "admin" in payload["roles"]
        assert "atlas_session" in response.cookies
    finally:
        auth_router.settings.auth_mode = previous_mode
        auth_router.settings.local_admin_username = previous_username


def test_local_login_rejects_wrong_password(client, db_session):
    previous_mode = auth_router.settings.auth_mode
    auth_router.settings.auth_mode = "local"
    try:
        db_session.add(
            LocalUser(
                username="admin",
                password_hash=hash_password("UnePhraseDePasseSolide!2026"),
                display_name="Administrateur",
                email=None,
                app_roles=["admin", "contributor", "auditor", "reader"],
                active=True,
            )
        )
        db_session.commit()
        response = client.post(
            "/api/auth/local/login",
            json={"username": "admin", "password": "incorrect"},
        )
        assert response.status_code in {401, 429}
        assert "mot de passe" in response.json()["detail"].lower()
    finally:
        auth_router.settings.auth_mode = previous_mode
