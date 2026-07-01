from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.routers import analysis, audit_events, auth, dashboard, design, features, health, imports, map, object_types, objects, quality, relation_types, relations, saved_maps, versions

settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.trusted_host_list + ["api", "localhost", "127.0.0.1", "testserver"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.app_secret_key,
    session_cookie="atlas_oidc_tmp",
    max_age=600,
    same_site="lax",
    https_only=settings.cookie_secure,
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unexpected_exception_handler(request: Request, exc: Exception):
    logger.exception("Erreur interne non gérée", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Une erreur interne est survenue.", "request_id": getattr(request.state, "request_id", None)},
    )


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(map.router)
app.include_router(saved_maps.router)
app.include_router(features.router)
app.include_router(imports.router)
app.include_router(analysis.router)
app.include_router(versions.router)
app.include_router(design.router)
app.include_router(quality.router)
app.include_router(object_types.router)
app.include_router(relation_types.router)
app.include_router(objects.router)
app.include_router(relations.router)
app.include_router(audit_events.router)
