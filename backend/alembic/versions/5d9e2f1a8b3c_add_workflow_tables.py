"""add workflow tables

Revision ID: 5d9e2f1a8b3c
Revises: 3f8a9b2c1d4e
Create Date: 2026-03-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '5d9e2f1a8b3c'
down_revision: Union[str, None] = '3f8a9b2c1d4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'workflow_rules',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('document_type', sa.String(length=100), nullable=True),
        sa.Column('sensitivity', sa.String(length=50), nullable=True),
        sa.Column('assign_to_role', sa.String(length=50), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'workflow_instances',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('document_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('rule_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['rule_id'], ['workflow_rules.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('document_id')
    )
    op.create_index(op.f('ix_workflow_instances_document_id'), 'workflow_instances', ['document_id'], unique=False)

    op.create_table(
        'workflow_tasks',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('instance_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assigned_to', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['instance_id'], ['workflow_instances.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assigned_to'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_workflow_tasks_instance_id'), 'workflow_tasks', ['instance_id'], unique=False)
    op.create_index(op.f('ix_workflow_tasks_assigned_to'), 'workflow_tasks', ['assigned_to'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_workflow_tasks_assigned_to'), table_name='workflow_tasks')
    op.drop_index(op.f('ix_workflow_tasks_instance_id'), table_name='workflow_tasks')
    op.drop_table('workflow_tasks')
    op.drop_index(op.f('ix_workflow_instances_document_id'), table_name='workflow_instances')
    op.drop_table('workflow_instances')
    op.drop_table('workflow_rules')
