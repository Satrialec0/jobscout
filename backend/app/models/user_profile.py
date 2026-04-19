from datetime import datetime, timezone
from sqlalchemy import Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

DEFAULT_INSTRUCTIONS = (
    "Analyze this job for overall fit based on my resume. "
    "Highlight skill gaps and strengths, and flag any responsibilities "
    "or requirements I should pay special attention to."
)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    resume_text: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default=DEFAULT_INSTRUCTIONS)
    app_assist_instructions: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
