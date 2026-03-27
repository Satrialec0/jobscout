from datetime import datetime, timezone
from sqlalchemy import Integer, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
    last_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)
    anthropic_api_key: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
