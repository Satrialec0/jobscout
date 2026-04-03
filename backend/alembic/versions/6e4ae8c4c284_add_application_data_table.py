"""add application_data table

Revision ID: 6e4ae8c4c284
Revises: a004_ext_job_id
Create Date: 2026-04-03 13:13:21.669643

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '6e4ae8c4c284'
down_revision: Union[str, Sequence[str], None] = 'a004_ext_job_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('application_data',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('job_analysis_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('cover_letter', sa.Text(), nullable=True),
    sa.Column('cover_letter_length', sa.String(length=10), nullable=True),
    sa.Column('salary_ask', sa.Integer(), nullable=True),
    sa.Column('questions', sa.JSON(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['job_analysis_id'], ['job_analyses.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_application_data_job_analysis_id'), 'application_data', ['job_analysis_id'], unique=False)
    op.create_index(op.f('ix_application_data_user_id'), 'application_data', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_application_data_user_id'), table_name='application_data')
    op.drop_index(op.f('ix_application_data_job_analysis_id'), table_name='application_data')
    op.drop_table('application_data')
