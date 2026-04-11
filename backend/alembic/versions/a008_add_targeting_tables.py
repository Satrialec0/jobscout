"""add targeting tables

Revision ID: a008_add_targeting_tables
Revises: a007_add_keyword_tables
Create Date: 2026-04-11
"""
from alembic import op
import sqlalchemy as sa

revision = "a008_add_targeting_tables"
down_revision = "a007_add_keyword_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_target_keywords",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("keyword", sa.String(200), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),  # 'resume' | 'learned'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("profile_id", "keyword", name="uq_target_kw_profile_keyword"),
    )
    op.create_index(
        "ix_profile_target_keywords_profile_id",
        "profile_target_keywords",
        ["profile_id"],
    )

    op.create_table(
        "profile_target_signals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ngram", sa.String(200), nullable=False),
        sa.Column("target_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("show_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "profile_id", "ngram", name="uq_target_signal_profile_ngram"
        ),
    )
    op.create_index(
        "ix_profile_target_signals_profile_id",
        "profile_target_signals",
        ["profile_id"],
    )

    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=True,  # NULL = global block
        ),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("list_type", sa.String(10), nullable=False),  # 'target' | 'block'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_companies_profile_id", "companies", ["profile_id"])
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_block_name "
        "ON companies (name, list_type) WHERE profile_id IS NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_companies_target_profile_name "
        "ON companies (profile_id, name, list_type) WHERE profile_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_companies_target_profile_name")
    op.execute("DROP INDEX IF EXISTS uq_companies_block_name")
    op.drop_index("ix_companies_profile_id", table_name="companies")
    op.drop_table("companies")
    op.drop_index(
        "ix_profile_target_signals_profile_id", table_name="profile_target_signals"
    )
    op.drop_table("profile_target_signals")
    op.drop_index(
        "ix_profile_target_keywords_profile_id", table_name="profile_target_keywords"
    )
    op.drop_table("profile_target_keywords")
