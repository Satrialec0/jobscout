from datetime import datetime, timezone
from sqlalchemy import Integer, String, Boolean, DateTime, Text, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class HiringCafeCredential(Base):
    """Stores the reconstructed Cookie header for a user's hiring.cafe session.
    All cookies for the domain are concatenated into a single header string,
    then Fernet-encrypted before storage."""
    __tablename__ = "hiring_cafe_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    cookie_header: Mapped[str] = mapped_column(Text, nullable=False)  # Fernet-encrypted
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class SavedSearch(Base):
    """A hiring.cafe search the user wants polled every hour."""
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    search_state: Mapped[dict] = mapped_column(JSON, nullable=False)  # decoded s= payload
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    last_polled: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)


class ScrapedJob(Base):
    """A job found by the background scraper that matches the user's targeting signals."""
    __tablename__ = "scraped_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    saved_search_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("saved_searches.id", ondelete="SET NULL"), nullable=True
    )
    object_id: Mapped[str] = mapped_column(String(200), nullable=False)  # hiring.cafe Algolia objectID
    apply_url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    company: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    found_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    analysis_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("job_analyses.id", ondelete="SET NULL"), nullable=True, default=None
    )

    __table_args__ = (UniqueConstraint("user_id", "object_id", name="uq_scraped_job_user_object"),)
