import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.models.base import Base
from app.models.user import User
from app.models.job import JobAnalysis
from app.services.auth import hash_password
from app.database import get_db
from app.main import app

TEST_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def test_user(db_session):
    user = User(
        email="test@example.com",
        password_hash=hash_password("testpassword"),
        first_name="Test",
        last_name="User",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield user
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def sample_jobs(db_session, test_user):
    """Four JobAnalysis rows with varying scores and statuses for filter/pagination tests."""
    def _job(**kwargs):
        defaults = dict(
            job_description="Test job description",
            should_apply=True,
            one_line_verdict="Good fit",
            direct_matches=[],
            transferable=[],
            gaps=[],
            red_flags=[],
            green_flags=[],
        )
        defaults.update(kwargs)
        return JobAnalysis(**defaults)

    jobs = [
        _job(user_id=test_user.id, url="https://linkedin.com/jobs/1", job_title="Senior Engineer", company="Acme", fit_score=90, status="applied"),
        _job(user_id=test_user.id, url="https://linkedin.com/jobs/2", job_title="Staff Engineer", company="Beta", fit_score=75, status=None),
        _job(user_id=test_user.id, url="https://indeed.com/jobs/3", job_title="Principal Engineer", company="Gamma", fit_score=85, status="applied"),
        _job(user_id=test_user.id, url="https://indeed.com/jobs/4", job_title="Junior Engineer", company="Delta", fit_score=55, status=None),
    ]
    for job in jobs:
        db_session.add(job)
    db_session.commit()
    return jobs
