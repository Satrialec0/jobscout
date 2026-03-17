from datetime import datetime, timezone
from sqlalchemy import Integer, String, Boolean, DateTime, Text, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class JobAnalysis(Base):
    __tablename__ = "job_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True, index=True)
    job_title: Mapped[str] = mapped_column(String(256), nullable=False)
    company: Mapped[str] = mapped_column(String(256), nullable=False)
    job_description: Mapped[str] = mapped_column(Text, nullable=False)
    fit_score: Mapped[int] = mapped_column(Integer, nullable=False)
    should_apply: Mapped[bool] = mapped_column(Boolean, nullable=False)
    one_line_verdict: Mapped[str] = mapped_column(String(512), nullable=False)
    direct_matches: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    transferable: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    gaps: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    red_flags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    green_flags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    salary_estimate: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)