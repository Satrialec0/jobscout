"""add profile columns to job_analyses

Revision ID: a006_add_profile_to_job_analyses
Revises: a005_add_user_profiles
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = "a006_add_profile_to_job_analyses"
down_revision = "a005_add_user_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_analyses",
        sa.Column("profile_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "job_analyses",
        sa.Column("profile_name", sa.String(100), nullable=True),
    )
    op.create_foreign_key(
        "fk_job_analyses_profile_id",
        "job_analyses",
        "user_profiles",
        ["profile_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_job_analyses_profile_id", "job_analyses", type_="foreignkey")
    op.drop_column("job_analyses", "profile_name")
    op.drop_column("job_analyses", "profile_id")
