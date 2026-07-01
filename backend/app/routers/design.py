from __future__ import annotations

import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import DesignSettings
from app.schemas import DesignSettingsRead, DesignSettingsUpdate, LogoUpload
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/design", tags=["Design"])

DEFAULTS = {
    "app_title": "Atlas SI",
    "app_subtitle": "Cartographie du système d’information",
    "logo_data_url": None,
    "theme_mode": "light",
    "primary_color": "#2563EB",
    "accent_color": "#D4AD42",
    "sidebar_color": "#0F172A",
    "background_color": "#F3F6FB",
    "surface_color": "#FFFFFF",
    "border_radius": 14,
    "default_language": "fr",
    "allow_user_language_choice": True,
    "updated_at": None,
}


def get_or_create(db: Session) -> DesignSettings:
    item = db.get(DesignSettings, 1)
    if item is None:
        item = DesignSettings(id=1)
        db.add(item)
        db.commit()
        db.refresh(item)
    return item


@router.get("/settings", response_model=DesignSettingsRead)
def read_design(db: Session = Depends(get_db)):
    item = db.get(DesignSettings, 1)
    return item if item else DEFAULTS


@router.put("/settings", response_model=DesignSettingsRead)
def update_design(
    payload: DesignSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = get_or_create(db)
    before = model_snapshot(item)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    write_audit(db, request, actor, action="update", entity_type="design_settings", entity_id="1", before=before, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item


@router.put("/logo", response_model=DesignSettingsRead)
def upload_logo(
    payload: LogoUpload,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    match = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)", payload.data_url)
    if not match:
        raise HTTPException(status_code=400, detail="Le logo doit être une image PNG, JPEG ou WebP encodée en base64.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Image base64 invalide.") from exc
    if len(raw) > 1_500_000:
        raise HTTPException(status_code=413, detail="Le logo ne doit pas dépasser 1,5 Mo.")
    mime = match.group(1)
    valid_signature = (
        (mime == "image/png" and raw.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in raw)
        or (mime == "image/jpeg" and raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9"))
        or (mime == "image/webp" and len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    )
    if not valid_signature:
        raise HTTPException(status_code=400, detail="Le contenu du logo ne correspond pas au type d’image annoncé.")
    item = get_or_create(db)
    before = model_snapshot(item)
    item.logo_data_url = payload.data_url
    write_audit(db, request, actor, action="update_logo", entity_type="design_settings", entity_id="1", before=before, after={"logo": "updated"})
    db.commit()
    db.refresh(item)
    return item


@router.delete("/logo", response_model=DesignSettingsRead)
def delete_logo(
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = get_or_create(db)
    before = model_snapshot(item)
    item.logo_data_url = None
    write_audit(db, request, actor, action="delete_logo", entity_type="design_settings", entity_id="1", before=before, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item
