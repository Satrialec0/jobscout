"""add users table

Revision ID: a001_add_users_table
Revises: 4ffcfd5ba25c
Create Date: 2026-03-25

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a001_add_users_table'
down_revision: Union[str, Sequence[str], None] = '4ffcfd5ba25c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(256), nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=False),
        sa.Column('anthropic_api_key', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
