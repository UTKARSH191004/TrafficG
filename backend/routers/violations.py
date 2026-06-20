"""
routers/violations.py — Violation records CRUD endpoints
"""
from fastapi import APIRouter, Query
from typing import Optional
from schemas.models import ViolationListResponse, ViolationRecord

router = APIRouter(prefix="/api", tags=["Violations"])


@router.get("/violations", response_model=ViolationListResponse)
async def get_violations(
    page:      int           = Query(1, ge=1),
    page_size: int           = Query(20, ge=1, le=100),
    severity:  Optional[str] = Query(None),
    type:      Optional[str] = Query(None),
):
    """Paginated violation records with optional filters."""
    from main import store
    result = store.get_violations(
        page=page,
        page_size=page_size,
        severity=severity,
        violation_type=type,
    )
    records = []
    for r in result["records"]:
        records.append(ViolationRecord(
            id          = r["id"],
            plate       = r.get("plate"),
            violation   = r["violation"],
            severity    = r["severity"],
            location    = r.get("location"),
            timestamp   = r["timestamp"],
            confidence  = r.get("confidence", 0.90),
            status      = r.get("status", "processed"),
            camera      = r.get("camera"),
            image_thumb = r.get("image_thumb"),
        ))
    return ViolationListResponse(
        total     = result["total"],
        page      = result["page"],
        page_size = result["page_size"],
        records   = records,
    )


@router.get("/violations/{violation_id}")
async def get_violation(violation_id: str):
    """Retrieve a single violation by ID."""
    from main import store
    result = store.get_violations(page_size=1000)
    for r in result["records"]:
        if r["id"] == violation_id:
            return r
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Violation not found")
