"""add status and extractions

Revision ID: 3f8a9b2c1d4e
Revises: 7c6795700258
Create Date: 2026-03-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '3f8a9b2c1d4e'
down_revision: Union[str, None] = '7c6795700258'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector extension is enabled in a later migration (Phase 5 — embeddings)
    op.add_column('documents', sa.Column('status', sa.String(length=50), nullable=False, server_default='uploaded'))

    op.create_table('document_extractions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('document_id', sa.UUID(), nullable=False),
    sa.Column('extracted_text', sa.Text(), nullable=True),
    sa.Column('document_type', sa.String(length=100), nullable=True),
    sa.Column('type_confidence', sa.Float(), nullable=True),
    sa.Column('key_fields', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('sensitivity', sa.String(length=20), nullable=True),
    sa.Column('risk_level', sa.String(length=10), nullable=True),
    sa.Column('risk_flags', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('gatekeeper_passed', sa.Boolean(), nullable=True),
    sa.Column('gatekeeper_issues', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('extracted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_extractions_document_id'), 'document_extractions', ['document_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_document_extractions_document_id'), table_name='document_extractions')
    op.drop_table('document_extractions')
    op.drop_column('documents', 'status')
