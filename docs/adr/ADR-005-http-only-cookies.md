# ADR-005: HTTP-Only Cookies Over localStorage for Web App Auth

**Status:** Accepted
**Date:** 2026-04-12

## Context

The web app needs to store a JWT to authenticate requests to the FastAPI backend. The Chrome extension stores its JWT in `chrome.storage.local`, which is isolated to the extension context and not accessible to web pages. The web app runs in a normal browser context where two storage mechanisms are available: `localStorage` and HTTP-only cookies.

## Decision

Issue the JWT as an HTTP-only cookie on web login. The browser sends the cookie automatically with every request to the backend. JavaScript on the web app cannot read the token value.

## Alternatives Considered

**localStorage:** Common approach. Simple to implement — store token on login, read on every request, clear on logout. The known risk: any JavaScript executing on the page can read `localStorage`. An XSS vulnerability (injected script via a compromised npm package, browser extension interference, or reflected XSS) can steal the token and use it from another origin. For a personal tool with a single user and no user-generated content, this risk is low but the mitigation is trivial.

**sessionStorage:** Same as localStorage but clears when the tab closes. Same XSS vulnerability. Token loss on tab close is an inconvenient tradeoff with no security benefit over HTTP-only cookies.

**In-memory storage (React state):** Token lives only in JavaScript memory — immune to XSS persistence but lost on page refresh, requiring re-login on every session. Rejected as unacceptable UX.

## Consequences

**Positive:**
- HTTP-only cookies cannot be read by JavaScript, making them immune to token theft via XSS regardless of what scripts execute on the page.
- `SameSite=Strict` prevents CSRF — cookies are not sent on cross-site requests.
- `Secure=True` ensures the cookie is only transmitted over HTTPS.
- `credentials: 'include'` in the frontend API client is the only change needed — no manual token management, no Authorization header construction, no localStorage reads.

**Negative:**
- Requires the frontend (`app.yourdomain.com`) and backend (`api.yourdomain.com`) to share a parent domain (`.yourdomain.com`) for the cookie to be sent cross-subdomain. This is a deployment constraint, not a code constraint — the user has a custom domain configured with Cloudflare.
- CORS must be configured with `allow_credentials=True` and an explicit `allow_origins` list (not `*`). Wildcard origins are incompatible with credentialed requests — this is a browser security requirement.
- The extension continues using `Bearer <token>` in the Authorization header. A separate `/auth/web-login` endpoint (or `web=true` flag) on the backend issues the cookie response. Both auth paths coexist; the extension path is unchanged.

**CORS configuration required:**
```python
CORSMiddleware(
    allow_origins=["https://app.yourdomain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Cookie configuration:**
```python
response.set_cookie(
    key="access_token",
    value=jwt_token,
    httponly=True,
    secure=True,
    samesite="strict",
    domain=".yourdomain.com",
    max_age=60 * 60 * 24 * 7  # 7 days
)
```
