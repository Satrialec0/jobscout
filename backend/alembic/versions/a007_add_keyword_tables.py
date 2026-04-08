"""add keyword blocklist and signal tables

Revision ID: a007_add_keyword_tables
Revises: a006_add_profile_to_job_analyses
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "a007_add_keyword_tables"
down_revision = "a006_add_profile_to_job_analyses"
branch_labels = None
depends_on = None

BAD_FIT_KEYWORDS = [
    "sales representative", "recruiter", "truck driver", "diesel mechanic",
    "retail associate", "customer service representative", "customer success",
    "customer service", "retail", "driver", "technician", "diesel",
    "mechanic", "hvac", "plumber", "carpenter", "welder",
]


def upgrade() -> None:
    op.create_table(
        "user_keyword_blocklist",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("term", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "term", name="uq_blocklist_user_term"),
    )
    op.create_index("ix_user_keyword_blocklist_user_id", "user_keyword_blocklist", ["user_id"])

    op.create_table(
        "profile_keyword_signals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ngram", sa.String(200), nullable=False),
        sa.Column("hide_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("show_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("profile_id", "ngram", name="uq_signal_profile_ngram"),
    )
    op.create_index("ix_profile_keyword_signals_profile_id", "profile_keyword_signals", ["profile_id"])

    # Seed existing users with the legacy hard-coded blocklist
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    for user in users:
        for term in BAD_FIT_KEYWORDS:
            conn.execute(
                sa.text(
                    "INSERT INTO user_keyword_blocklist (user_id, term) "
                    "VALUES (:uid, :term) ON CONFLICT DO NOTHING"
                ),
                {"uid": user.id, "term": term},
            )


def downgrade() -> None:
    op.drop_index("ix_profile_keyword_signals_profile_id", table_name="profile_keyword_signals")
    op.drop_table("profile_keyword_signals")
    op.drop_index("ix_user_keyword_blocklist_user_id", table_name="user_keyword_blocklist")
    op.drop_table("user_keyword_blocklist")
