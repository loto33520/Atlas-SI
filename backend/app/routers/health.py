from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db

router = APIRouter(prefix="/api/health", tags=["Santé"])
settings = get_settings()


@router.get("/live")
def live() -> dict:
    return {"status": "ok", "version": settings.app_version}


@router.get("/ready")
def ready(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Base de données indisponible.") from exc
    return {"status": "ready", "database": "ok", "authentication": settings.auth_mode, "version": settings.app_version}
