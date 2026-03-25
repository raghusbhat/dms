"""
Creates the initial Admin role and admin user.
Run once after migrations:
  python scripts/create_admin.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.user import Role, User
from app.auth.security import hash_password


async def main() -> None:
    async with AsyncSessionLocal() as db:
        # Create Admin role if it doesn't exist
        result = await db.execute(select(Role).where(Role.name == "Admin"))
        role = result.scalar_one_or_none()

        if not role:
            role = Role(name="Admin", description="Full system access")
            db.add(role)
            await db.flush()
            print("Created role: Admin")
        else:
            print("Role Admin already exists")

        # Check if any user exists
        result = await db.execute(select(User).limit(1))
        existing = result.scalar_one_or_none()

        if existing:
            print(f"User already exists: {existing.email} — skipping creation")
            await db.commit()
            return

        email = input("Admin email: ").strip()
        name = input("Admin name: ").strip()
        password = input("Admin password: ").strip()

        if not email or not password:
            print("Email and password are required.")
            sys.exit(1)

        user = User(
            email=email,
            name=name,
            hashed_password=hash_password(password),
            role_id=role.id,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        print(f"\nAdmin user created: {email}")
        print("You can now log in.")


asyncio.run(main())
