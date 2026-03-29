"""add checksum and change_note to document_versions

Revision ID: b3c4d5e6f7a8
Revises: 7f8e9d0a1b2c
Create Date: 2026-03-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "7f8e9d0a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "document_versions",
        sa.Column("checksum", sa.String(64), nullable=True),
    )
    op.add_column(
        "document_versions",
        sa.Column("change_note", sa.Text(), nullable=True),
    )
    # Index for fast duplicate detection by checksum
    op.create_index(
        "ix_document_versions_checksum",
        "document_versions",
        ["checksum"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_versions_checksum", table_name="document_versions")
    op.drop_column("document_versions", "change_note")
    op.drop_column("document_versions", "checksum")
