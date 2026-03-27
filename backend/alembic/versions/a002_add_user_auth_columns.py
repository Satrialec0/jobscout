"""add user auth columns to job_analyses

Revision ID: a002_add_user_auth_columns
Revises: a001_add_users_table
Create Date: 2026-03-25

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a002_add_user_auth_columns'
down_revision: Union[str, Sequence[str], None] = 'a001_add_users_table'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_analyses', sa.Column('user_id', sa.Integer(), nullable=True))
    op.add_column('job_analyses', sa.Column('status', sa.String(32), nullable=True))
    op.add_column('job_analyses', sa.Column('applied_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('job_analyses', sa.Column('notes', sa.Text(), nullable=True))
    op.create_foreign_key(
        'fk_job_analyses_user_id', 'job_analyses', 'users',
        ['user_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_job_analyses_user_id', 'job_analyses', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_job_analyses_user_id', table_name='job_analyses')
    op.drop_constraint('fk_job_analyses_user_id', 'job_analyses', type_='foreignkey')
    op.drop_column('job_analyses', 'notes')
    op.drop_column('job_analyses', 'applied_date')
    op.drop_column('job_analyses', 'status')
    op.drop_column('job_analyses', 'user_id')
