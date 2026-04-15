from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app
from app.services.auth import create_access_token

client = TestClient(app)


def test_bearer_token_still_works(db_session, test_user):
    """Existing Bearer auth must not break."""
    token = create_access_token(test_user.id)
    resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == test_user.email


def test_cookie_auth_works(db_session, test_user):
    """HTTP-only cookie should authenticate the same as a Bearer token."""
    token = create_access_token(test_user.id)
    resp = client.get(
        "/api/v1/auth/me",
        cookies={"access_token": token},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == test_user.email


def test_no_auth_returns_401(db_session):
    """Request with no token returns 401."""
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_web_login_sets_cookie(db_session, test_user):
    resp = client.post(
        "/api/v1/auth/web-login",
        json={"email": test_user.email, "password": "testpassword"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.cookies
    assert resp.json() == {"ok": True}


def test_web_login_wrong_password(db_session, test_user):
    resp = client.post(
        "/api/v1/auth/web-login",
        json={"email": test_user.email, "password": "wrongpassword"},
    )
    assert resp.status_code == 401


def test_web_logout_clears_cookie(db_session, test_user):
    token = create_access_token(test_user.id)
    resp = client.post(
        "/api/v1/auth/web-logout",
        cookies={"access_token": token},
    )
    assert resp.status_code == 200
    assert resp.cookies.get("access_token", "") == ""
