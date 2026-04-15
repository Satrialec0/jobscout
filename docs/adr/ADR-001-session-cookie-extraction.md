# ADR-001: Session Cookie Extraction via Chrome Extension for hiring.cafe Auth

**Status:** Accepted
**Date:** 2026-04-12

## Context

The background scraper needs to authenticate with hiring.cafe's internal API (`/api/search-jobs`) to poll the user's saved searches. hiring.cafe uses Firebase Authentication and issues server-side session cookies — there is no public OAuth flow or API key mechanism available to third parties.

The scraper runs on the backend server, which does not have access to the user's browser session. Several approaches were considered for bridging this gap.

## Decision

Use the Chrome extension's `chrome.cookies` API to read the user's active hiring.cafe session cookie and ship it (encrypted) to the backend on every navigation to hiring.cafe. The backend stores the encrypted cookie and uses it for scraper requests until it expires.

## Alternatives Considered

**OAuth / official API:** hiring.cafe does not offer a public API or OAuth flow. Not available.

**User logs into hiring.cafe through the web app:** Would create a second independent hiring.cafe session. Fragile, confusing UX, no guarantee the session state matches the user's real account preferences and saved searches.

**Backend Playwright / headless browser:** User-cited concern about complexity and resource overhead. Requires the backend to maintain a full browser process, handle bot detection, and manage credentials separately. Not appropriate for a lightweight personal tool.

**Residential proxy with credential injection:** Overengineered. Requires proxy infrastructure, paid services, and ongoing maintenance. Designed for adversarial scraping at scale — not this use case.

## Consequences

**Positive:**
- Session cookie is never re-entered by the user — it flows automatically on every hiring.cafe visit.
- Chrome extensions can read HttpOnly cookies via `chrome.cookies`, which page-level JavaScript cannot. This is intentional by design in the extension permission model.
- Natural refresh cycle: the user visits hiring.cafe daily, so the cookie is refreshed before it can expire in normal usage.
- Session cookie never transits in plaintext — HTTPS in transit, Fernet-encrypted at rest.

**Negative:**
- The scraper stops working if Chrome is not opened for longer than the session TTL (days to weeks depending on hiring.cafe's Firebase session configuration).
- If hiring.cafe changes their auth mechanism (e.g. moves to short-lived tokens), the approach requires updating.
- Requires the `cookies` permission in `manifest.json`, which is a broad permission that warrants disclosure to users.

**Mitigation:**
- Email notification sent when session expires so the user knows to visit hiring.cafe.
- Scraper resumes automatically on next extension navigation — no manual re-authentication step.
