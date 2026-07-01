from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: str = "production"
    app_name: str = "Atlas SI"
    app_version: str = "2.2.0"
    public_base_url: str = "https://carto.example.org"
    trusted_hosts: str = "carto.example.org"
    app_secret_key: str = Field(min_length=32)
    session_ttl_hours: int = Field(default=8, ge=1, le=72)
    cookie_secure: bool = True

    database_url: str

    # Choix exclusif du mode d'authentification.
    auth_mode: Literal["local", "keycloak"] = "keycloak"

    # Paramètres Keycloak, obligatoires uniquement en mode keycloak.
    oidc_issuer_url: str = ""
    oidc_client_id: str = "carto-app"
    oidc_client_secret: str = ""
    oidc_scopes: str = "openid profile email"

    auth_admin_values: str = "ATLAS-ADMINISTRATEURS,/ATLAS-ADMINISTRATEURS"
    auth_contributor_values: str = "ATLAS-CONTRIBUTEURS,/ATLAS-CONTRIBUTEURS"
    auth_auditor_values: str = "ATLAS-AUDITEURS,/ATLAS-AUDITEURS"
    auth_reader_values: str = "ATLAS-LECTEURS,/ATLAS-LECTEURS"
    allow_authenticated_read: bool = True

    # Compte administrateur initial, utilisé uniquement en mode local.
    local_admin_username: str = "admin"
    local_admin_password: str = ""
    local_admin_display_name: str = "Administrateur Atlas SI"
    local_admin_email: str = ""
    # À passer temporairement à true pour réaligner le mot de passe stocké sur LOCAL_ADMIN_PASSWORD.
    local_admin_reset_password: bool = False
    local_login_max_attempts: int = Field(default=5, ge=3, le=20)
    local_login_window_seconds: int = Field(default=900, ge=60, le=86400)

    # Profil fonctionnel utilisé uniquement lors de la première initialisation.
    # minimal : référentiel + cartographie ; complete : tous les modules activés.
    feature_profile: Literal["minimal", "complete"] = "complete"
    map_max_recursion_depth: int = Field(default=10, ge=1, le=20)
    map_max_displayed_nodes: int = Field(default=1200, ge=50, le=5000)

    log_level: str = "INFO"

    @field_validator("public_base_url", "oidc_issuer_url")
    @classmethod
    def strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("local_admin_username")
    @classmethod
    def normalize_local_username(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not normalized:
            raise ValueError("LOCAL_ADMIN_USERNAME ne peut pas être vide.")
        if len(normalized) > 120:
            raise ValueError("LOCAL_ADMIN_USERNAME est trop long.")
        return normalized

    @model_validator(mode="after")
    def validate_authentication(self) -> "Settings":
        if self.auth_mode == "keycloak":
            if not self.oidc_issuer_url.startswith(("https://", "http://")):
                raise ValueError("OIDC_ISSUER_URL doit être renseignée en mode keycloak.")
            if not self.oidc_client_id.strip():
                raise ValueError("OIDC_CLIENT_ID doit être renseigné en mode keycloak.")
            if len(self.oidc_client_secret) < 8:
                raise ValueError("OIDC_CLIENT_SECRET doit contenir au moins 8 caractères en mode keycloak.")
        else:
            if len(self.local_admin_password) < 12:
                raise ValueError("LOCAL_ADMIN_PASSWORD doit contenir au moins 12 caractères en mode local.")
            if self.local_admin_password.casefold() in {"password", "motdepasse", "administrateur", "admin12345678"}:
                raise ValueError("LOCAL_ADMIN_PASSWORD est trop facile à deviner.")
        return self

    @property
    def trusted_host_list(self) -> list[str]:
        return [item.strip() for item in self.trusted_hosts.split(",") if item.strip()]

    @property
    def public_origin(self) -> str:
        parsed = urlparse(self.public_base_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    @staticmethod
    def _split_values(raw: str) -> set[str]:
        return {item.strip().casefold() for item in raw.split(",") if item.strip()}

    @property
    def role_mappings(self) -> dict[str, set[str]]:
        return {
            "admin": self._split_values(self.auth_admin_values),
            "contributor": self._split_values(self.auth_contributor_values),
            "auditor": self._split_values(self.auth_auditor_values),
            "reader": self._split_values(self.auth_reader_values),
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
