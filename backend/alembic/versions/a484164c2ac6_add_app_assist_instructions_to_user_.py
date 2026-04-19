"""add app_assist_instructions to user_profiles

Revision ID: a484164c2ac6
Revises: f1fc99685891
Create Date: 2026-04-16 12:10:48.834244

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a484164c2ac6'
down_revision: Union[str, Sequence[str], None] = 'f1fc99685891'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('user_profiles', sa.Column('app_assist_instructions', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user_profiles', 'app_assist_instructions')
