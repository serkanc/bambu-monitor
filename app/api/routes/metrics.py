"""Metrics endpoint for operational visibility."""
from fastapi import APIRouter

from app.core.metrics import metrics

router = APIRouter()


@router.get("/metrics", summary="Return aggregated API/service metrics")
async def read_metrics() -> dict:
    return {
        "metrics": metrics.snapshot(),
    }
