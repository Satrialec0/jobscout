from datetime import datetime, timezone
from sqlalchemy import Integer, String, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class ApplicationData(Base):
    __tablename__ = "application_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_analysis_id: Mapped[int] = mapped_column(Integer, ForeignKey("job_analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cover_letter: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    cover_letter_length: Mapped[str | None] = mapped_column(String(10), nullable=True, default=None)
    salary_ask: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    questions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
