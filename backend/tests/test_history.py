from fastapi.testclient import TestClient
from app.main import app
from app.services.auth import create_access_token

client = TestClient(app)


def test_history_pagination(db_session, test_user, sample_jobs):
    """offset and limit control which page of results returns."""
    token = create_access_token(test_user.id)
    headers = {"Authorization": f"Bearer {token}"}

    page1 = client.get("/api/v1/history?limit=2&offset=0", headers=headers)
    page2 = client.get("/api/v1/history?limit=2&offset=2", headers=headers)

    assert page1.status_code == 200
    assert page2.status_code == 200
    ids_page1 = [j["id"] for j in page1.json()]
    ids_page2 = [j["id"] for j in page2.json()]
    assert len(set(ids_page1) & set(ids_page2)) == 0  # no overlap


def test_history_filter_by_status(db_session, test_user, sample_jobs):
    token = create_access_token(test_user.id)
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.get("/api/v1/history?status=applied", headers=headers)
    assert resp.status_code == 200
    for job in resp.json():
        assert job["status"] == "applied"


def test_history_filter_by_min_score(db_session, test_user, sample_jobs):
    token = create_access_token(test_user.id)
    resp = client.get(
        "/api/v1/history?min_score=80",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    for job in resp.json():
        assert job["fit_score"] >= 80
