"""add ext_job_id to job_analyses

Revision ID: a004_add_ext_job_id_to_job_analyses
Revises: a003_add_name_columns_to_users
Create Date: 2026-03-25

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a004_ext_job_id"
down_revision: Union[str, None] = "a003_add_name_columns_to_users"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_analyses", sa.Column("ext_job_id", sa.String(64), nullable=True))
    op.create_index("ix_job_analyses_ext_job_id", "job_analyses", ["ext_job_id"])


def downgrade() -> None:
    op.drop_index("ix_job_analyses_ext_job_id", table_name="job_analyses")
    op.drop_column("job_analyses", "ext_job_id")
