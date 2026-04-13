import json
import logging
import urllib.parse
import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://hiring.cafe"


class HiringCafeAuthError(Exception):
    """Raised when the hiring.cafe session cookie is expired or invalid."""


class HiringCafeRateLimitError(Exception):
    """Raised on 503 — caller should apply exponential backoff."""


def build_search_url(search_state: dict, page: int = 0, size: int = 40) -> str:
    """Build the full /api/search-jobs URL from a decoded search state dict."""
    encoded = urllib.parse.quote(json.dumps(search_state))
    return f"{BASE_URL}/api/search-jobs?s={encoded}&size={size}&page={page}&sv=control"


def parse_job_from_result(raw: dict) -> dict:
    """Extract the fields we care about from a single hiring.cafe result object."""
    ji = raw.get("job_information") or {}
    co = raw.get("enriched_company_data") or {}
    return {
        "object_id": raw.get("objectID", ""),
        "apply_url": raw.get("apply_url", ""),
        "title": ji.get("title", ""),
        "company": co.get("name", ""),
        "description": ji.get("description", ""),
    }


async def fetch_search(search_state: dict, cookie_header: str) -> list[dict]:
    """Fetch one page of results for a saved search.

    Args:
        search_state: Decoded JSON dict representing the search filters.
        cookie_header: Raw Cookie header value (e.g. "session=abc; other=xyz").

    Returns:
        List of parsed job dicts (object_id, apply_url, title, company, description).

    Raises:
        HiringCafeAuthError: If the response is HTML (expired/invalid session).
        HiringCafeRateLimitError: If the server returns 503.
    """
    url = build_search_url(search_state)
    headers = {
        "Cookie": cookie_header,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, headers=headers)

    if response.status_code == 503:
        raise HiringCafeRateLimitError("503 from hiring.cafe")

    if response.status_code == 403:
        raise HiringCafeAuthError("403 — session likely expired")

    content_type = response.headers.get("content-type", "")
    if "text/html" in content_type:
        raise HiringCafeAuthError("HTML response — session expired or invalid")

    try:
        data = response.json()
    except Exception as e:
        raise HiringCafeAuthError(f"Non-JSON response: {e}") from e

    results = data.get("results", [])
    return [parse_job_from_result(r) for r in results if r.get("objectID")]
