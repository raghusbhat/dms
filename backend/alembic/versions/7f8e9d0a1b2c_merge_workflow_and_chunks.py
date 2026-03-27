"""merge workflow and chunks migrations

Revision ID: 7f8e9d0a1b2c
Revises: a1b2c3d4e5f6, 19dfaeab2f5a
Create Date: 2026-03-27

"""
from typing import Sequence, Union

from alembic import op

revision: str = '7f8e9d0a1b2c'
down_revision: Union[tuple[str, ...], None] = ('a1b2c3d4e5f6', '19dfaeab2f5a')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
