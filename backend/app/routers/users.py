import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth.dependencies import get_current_user, require_role
from app.auth.security import hash_password
from app.database import get_db
from app.models.user import Role, User

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class RoleOut(BaseModel):
    id: str
    name: str
    description: str | None


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str | None
    role_id: str | None
    is_active: bool


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role_id: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role_id: str | None = None
    is_active: bool | None = None
    password: str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        name=user.name,
        email=user.email,
        role=user.role.name if user.role else None,
        role_id=str(user.role_id) if user.role_id else None,
        is_active=user.is_active,
    )


async def _get_user_or_404(db: AsyncSession, user_id: str) -> User:
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.execute(
        select(User).options(joinedload(User.role)).where(User.id == uid)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── Roles ─────────────────────────────────────────────────────────────────────

@router.get("/roles", response_model=list[RoleOut])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("Admin")),
) -> list[RoleOut]:
    result = await db.execute(select(Role).order_by(Role.name))
    return [
        RoleOut(id=str(r.id), name=r.name, description=r.description)
        for r in result.scalars().all()
    ]


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("Admin")),
) -> list[UserOut]:
    result = await db.execute(
        select(User).options(joinedload(User.role)).order_by(User.name)
    )
    return [_user_out(u) for u in result.unique().scalars().all()]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("Admin")),
) -> UserOut:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    role_id = None
    if body.role_id:
        try:
            role_id = uuid.UUID(body.role_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid role_id")
        role_check = await db.execute(select(Role).where(Role.id == role_id))
        if not role_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Role not found")

    user = User(
        name=body.name,
        email=body.email,
        hashed_password=hash_password(body.password),
        role_id=role_id,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    result = await db.execute(
        select(User).options(joinedload(User.role)).where(User.id == user.id)
    )
    return _user_out(result.scalar_one())


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
) -> UserOut:
    user = await _get_user_or_404(db, user_id)

    if body.name is not None:
        user.name = body.name

    if body.role_id is not None:
        try:
            rid = uuid.UUID(body.role_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid role_id")
        role_check = await db.execute(select(Role).where(Role.id == rid))
        if not role_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Role not found")
        user.role_id = rid

    if body.is_active is not None:
        if str(user.id) == str(current_user.id) and not body.is_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        user.is_active = body.is_active

    if body.password is not None:
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        user.hashed_password = hash_password(body.password)

    await db.commit()

    result = await db.execute(
        select(User).options(joinedload(User.role)).where(User.id == user.id)
    )
    return _user_out(result.scalar_one())


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
) -> None:
    user = await _get_user_or_404(db, user_id)
    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    await db.delete(user)
    await db.commit()
