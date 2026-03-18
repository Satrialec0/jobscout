"""increase url column to text

Revision ID: 681670c88f3b
Revises: 0441c78cee78
Create Date: 2026-03-17 18:15:20.744079

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '681670c88f3b'
down_revision: Union[str, Sequence[str], None] = '0441c78cee78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('job_analyses', 'url',
        existing_type=sa.VARCHAR(length=2048),
        type_=sa.Text(),
        existing_nullable=True)

def downgrade() -> None:
    op.alter_column('job_analyses', 'url',
        existing_type=sa.Text(),
        type_=sa.VARCHAR(length=2048),
        existing_nullable=True)