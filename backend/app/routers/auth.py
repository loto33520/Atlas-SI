from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet
from joserfc.jwt import JWTClaimsRegistry
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.local_auth import login_limiter, verify_password
from app.models import AuthSession, LocalUser
from app.schemas import AuthConfigRead, CurrentUserRead, LocalLoginRequest
from app.security import (
    SESSION_COOKIE_NAME,
    AuthContext,
    get_auth_context,
    map_application_roles,
    purge_expired_sessions,
    require_access,
    utcnow,
)

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["Authentification"])

oauth = OAuth()
if settings.auth_mode == "keycloak":
    oauth.register(
        name="keycloak",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=f"{settings.oidc_issuer_url}/.well-known/openid-configuration",
        client_kwargs={"scope": settings.oidc_scopes, "code_challenge_method": "S256"},
    )


def _safe_next_path(value: str | None) -> str:
    if value and value.startswith("/") and not value.startswith("//"):
        return value
    return "/"


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _new_session(
    db: Session,
    *,
    subject: str,
    username: str,
    email: str | None,
    display_name: str,
    app_roles: list[str],
    keycloak_roles: list[str] | None = None,
    groups: list[str] | None = None,
) -> AuthSession:
    purge_expired_sessions(db)
    auth_session = AuthSession(
        id=secrets.token_urlsafe(48),
        subject=subject,
        username=username,
        email=email,
        display_name=display_name,
        app_roles=app_roles,
        keycloak_roles=keycloak_roles or [],
        groups=groups or [],
        csrf_token=secrets.token_urlsafe(36),
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
        last_seen_at=utcnow(),
    )
    db.add(auth_session)
    db.commit()
    db.refresh(auth_session)
    return auth_session


def _session_user(auth_session: AuthSession) -> CurrentUserRead:
    return CurrentUserRead(
        subject=auth_session.subject,
        username=auth_session.username,
        email=auth_session.email,
        display_name=auth_session.display_name,
        roles=list(auth_session.app_roles),
        groups=list(auth_session.groups),
        csrf_token=auth_session.csrf_token,
    )


async def _oidc_metadata() -> dict:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        response = await client.get(f"{settings.oidc_issuer_url}/.well-known/openid-configuration")
        response.raise_for_status()
        return response.json()


async def _validated_access_claims(access_token: str) -> dict:
    metadata = await _oidc_metadata()
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        response = await client.get(metadata["jwks_uri"])
        response.raise_for_status()
        jwks = response.json()

    key_set = KeySet.import_key_set(jwks)
    token = jwt.decode(access_token, key_set)
    claims_registry = JWTClaimsRegistry(
        leeway=30,
        iss={"essential": True, "value": settings.oidc_issuer_url},
        exp={"essential": True},
        sub={"essential": True},
        azp={"essential": True, "value": settings.oidc_client_id},
    )
    claims_registry.validate(token.claims)
    return dict(token.claims)


def _list_claim(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value]
    return []


@router.get("/config", response_model=AuthConfigRead)
def auth_config() -> AuthConfigRead:
    return AuthConfigRead(
        mode=settings.auth_mode,
        local_username_hint=settings.local_admin_username if settings.auth_mode == "local" else None,
    )


@router.post("/local/login", response_model=CurrentUserRead)
def local_login(payload: LocalLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if settings.auth_mode != "local":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authentification locale désactivée.")

    blocked = login_limiter.remaining_block_seconds(
        request,
        payload.username,
        window_seconds=settings.local_login_window_seconds,
    )
    if blocked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Trop de tentatives. Réessaie dans {blocked} seconde(s).",
            headers={"Retry-After": str(blocked)},
        )

    user = db.scalar(select(LocalUser).where(LocalUser.username == payload.username))
    valid = bool(user and user.active and verify_password(payload.password, user.password_hash))
    if not valid:
        delay = login_limiter.fail(
            request,
            payload.username,
            max_attempts=settings.local_login_max_attempts,
            window_seconds=settings.local_login_window_seconds,
        )
        logger.warning("Échec de connexion locale pour %s", payload.username)
        headers = {"Retry-After": str(delay)} if delay else None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED if not delay else status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Identifiant ou mot de passe incorrect.",
            headers=headers,
        )

    login_limiter.success(request, payload.username)
    user.last_login_at = utcnow()
    auth_session = _new_session(
        db,
        subject=f"local:{user.id}",
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        app_roles=list(user.app_roles),
        groups=["LOCAL-ADMINISTRATEURS"] if "admin" in user.app_roles else [],
    )
    _set_session_cookie(response, auth_session.id)
    return _session_user(auth_session)


@router.get("/login")
async def login(request: Request, next: str | None = Query(default=None)):
    if settings.auth_mode != "keycloak":
        return RedirectResponse(url=f"{settings.public_base_url}{_safe_next_path(next)}", status_code=303)
    request.session["atlas_next"] = _safe_next_path(next)
    redirect_uri = f"{settings.public_base_url}/api/auth/callback"
    return await oauth.keycloak.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    if settings.auth_mode != "keycloak":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Authentification Keycloak désactivée.")
    try:
        token = await oauth.keycloak.authorize_access_token(request)
        access_claims = await _validated_access_claims(token["access_token"])
    except (OAuthError, JoseError, httpx.HTTPError, KeyError) as exc:
        logger.exception("Échec de l'authentification OpenID Connect")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Échec de l'authentification OpenID Connect.",
        ) from exc

    userinfo = dict(token.get("userinfo") or {})
    subject = str(userinfo.get("sub") or access_claims.get("sub") or "")
    if not subject:
        raise HTTPException(status_code=401, detail="Le jeton Keycloak ne contient pas d'identifiant utilisateur.")

    realm_roles = _list_claim((access_claims.get("realm_access") or {}).get("roles"))
    client_roles = _list_claim(
        ((access_claims.get("resource_access") or {}).get(settings.oidc_client_id) or {}).get("roles")
    )
    groups = _list_claim(access_claims.get("groups")) or _list_claim(userinfo.get("groups"))
    keycloak_roles = sorted(set([*realm_roles, *client_roles]), key=str.casefold)
    app_roles = map_application_roles(keycloak_roles, groups)
    if not app_roles:
        raise HTTPException(status_code=403, detail="Aucun rôle Atlas SI n'est associé à cet utilisateur.")

    username = str(
        userinfo.get("preferred_username")
        or access_claims.get("preferred_username")
        or userinfo.get("email")
        or subject
    )
    display_name = str(userinfo.get("name") or access_claims.get("name") or username)
    email = userinfo.get("email") or access_claims.get("email")

    auth_session = _new_session(
        db,
        subject=subject,
        username=username,
        email=str(email) if email else None,
        display_name=display_name,
        app_roles=app_roles,
        keycloak_roles=keycloak_roles,
        groups=groups,
    )

    next_path = _safe_next_path(request.session.pop("atlas_next", "/"))
    request.session.clear()
    response = RedirectResponse(url=f"{settings.public_base_url}{next_path}", status_code=303)
    _set_session_cookie(response, auth_session.id)
    return response


@router.get("/me", response_model=CurrentUserRead)
def me(context: AuthContext = Depends(get_auth_context)) -> CurrentUserRead:
    return CurrentUserRead(
        subject=context.subject,
        username=context.username,
        email=context.email,
        display_name=context.display_name,
        roles=list(context.roles),
        groups=list(context.groups),
        csrf_token=context.csrf_token,
    )


@router.post("/logout")
async def logout(
    context: AuthContext = Depends(require_access("reader", csrf=True)),
    db: Session = Depends(get_db),
):
    auth_session = db.get(AuthSession, context.session_id)
    if auth_session:
        db.delete(auth_session)
        db.commit()

    logout_url = settings.public_base_url
    if settings.auth_mode == "keycloak":
        try:
            metadata = await _oidc_metadata()
            endpoint = metadata.get("end_session_endpoint")
        except httpx.HTTPError:
            endpoint = None
        if endpoint:
            logout_url = f"{endpoint}?{urlencode({'client_id': settings.oidc_client_id, 'post_logout_redirect_uri': settings.public_base_url})}"

    response = JSONResponse({"logout_url": logout_url})
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=settings.cookie_secure, samesite="lax")
    return response
