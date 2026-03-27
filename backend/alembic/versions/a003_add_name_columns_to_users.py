"""add first_name and last_name to users

Revision ID: a003_add_name_columns_to_users
Revises: a002_add_user_auth_columns
Create Date: 2026-03-25

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a003_add_name_columns_to_users"
down_revision: Union[str, None] = "a002_add_user_auth_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(128), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
