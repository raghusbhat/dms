from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    from app.config import settings

    return HealthResponse(
        status="ok",
        version="0.1.0",
        environment=settings.environment,
    )
