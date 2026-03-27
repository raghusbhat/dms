"""
Seeds reviewer/uploader roles, a test reviewer user, and the catch-all workflow rule.
Safe to run multiple times (idempotent).

  python scripts/seed_workflow.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.user import Role, User
from app.models.workflow import WorkflowRule
from app.auth.security import hash_password


async def main() -> None:
    async with AsyncSessionLocal() as db:

        # --- Roles ---
        for role_name, description in [
            ("reviewer", "Can approve, reject, or return documents"),
            ("uploader", "Can upload documents"),
        ]:
            result = await db.execute(select(Role).where(Role.name == role_name))
            if not result.scalar_one_or_none():
                db.add(Role(name=role_name, description=description))
                print(f"Created role: {role_name}")
            else:
                print(f"Role already exists: {role_name}")

        await db.flush()

        # --- Test reviewer user ---
        reviewer_email = "reviewer@perspectiv.in"
        result = await db.execute(select(User).where(User.email == reviewer_email))
        if not result.scalar_one_or_none():
            result = await db.execute(select(Role).where(Role.name == "reviewer"))
            reviewer_role = result.scalar_one()
            db.add(User(
                email=reviewer_email,
                name="Test Reviewer",
                hashed_password=hash_password("reviewer123"),
                role_id=reviewer_role.id,
                is_active=True,
            ))
            print(f"Created user: {reviewer_email} / reviewer123")
        else:
            print(f"User already exists: {reviewer_email}")

        # --- Catch-all workflow rule ---
        result = await db.execute(
            select(WorkflowRule).where(WorkflowRule.name == "Default Review")
        )
        if not result.scalar_one_or_none():
            db.add(WorkflowRule(
                name="Default Review",
                document_type=None,
                sensitivity=None,
                assign_to_role="reviewer",
                is_active=True,
            ))
            print("Created workflow rule: Default Review (catch-all → reviewer)")
        else:
            print("Workflow rule already exists: Default Review")

        await db.commit()
        print("\nDone. You can now:")
        print("  1. Upload a document as admin")
        print("  2. Log in as reviewer@perspectiv.in / reviewer123")
        print("  3. Go to Tasks page to approve/reject")


asyncio.run(main())
