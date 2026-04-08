# User & Profile-Scoped Job Card Dimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded keyword blocklist and flat keyword signals with a backend-persisted, user/profile-scoped system so different users and profiles accumulate independent dimming data that syncs across devices.

**Architecture:** The backend gains two new tables (`user_keyword_blocklist`, `profile_keyword_signals`) and five new endpoints under `/api/v1/keywords`. The extension background service worker seeds `chrome.storage.local` from these endpoints on login and profile switch, maintains a dirty set of changed ngrams, and debounce-flushes them back to the backend. The content script is unchanged structurally — it still reads flat `kw_*` keys — but the hard-coded `BAD_FIT_KEYWORDS` array is replaced by a `blocklist` key seeded from the backend. The settings page gains a "Keyword Filters" tab for managing the blocklist.

**Tech Stack:** Python/FastAPI, SQLAlchemy, Alembic, PostgreSQL, TypeScript/MV3 Chrome extension, vanilla JS/HTML/CSS (settings page)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `backend/app/models/keyword.py` | ORM models for both keyword tables |
| Create | `backend/app/schemas/keyword.py` | Pydantic request/response schemas |
| Create | `backend/alembic/versions/a007_add_keyword_tables.py` | Migration: create tables + seed existing users |
| Create | `backend/app/api/keywords.py` | 5 route handlers |
| Modify | `backend/app/main.py` | Register keywords router |
| Create | `backend/tests/test_keywords.py` | Structural tests |
| Modify | `extension/src/background/index.ts` | Seed on login/switch, debounced sync, clear on logout |
| Modify | `extension/src/dashboard/index.ts` | Send SWITCH_PROFILE message after profile activation |
| Modify | `extension/src/content/index.ts` | Replace BAD_FIT_KEYWORDS with blocklist var, handle PROFILE_SWITCHED |
| Modify | `backend/app/static/web/settings.html` | Add tab bar + Keyword Filters panel |
| Modify | `backend/app/static/web/settings.js` | Tab switching logic + blocklist CRUD |
| Modify | `backend/app/static/web/style.css` | Tab styles, keyword list styles |

---

## Task 1: Backend DB models

**Files:**
- Create: `backend/app/models/keyword.py`

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_keywords.py`:

```python
# backend/tests/test_keywords.py
from app.models.keyword import UserKeywordBlocklist, ProfileKeywordSignal


def test_user_keyword_blocklist_columns():
    cols = {c.key for c in UserKeywordBlocklist.__table__.columns}
    assert "id" in cols
    assert "user_id" in cols
    assert "term" in cols
    assert "created_at" in cols


def test_profile_keyword_signal_columns():
    cols = {c.key for c in ProfileKeywordSignal.__table__.columns}
    assert "id" in cols
    assert "profile_id" in cols
    assert "ngram" in cols
    assert "hide_count" in cols
    assert "show_count" in cols
    assert "updated_at" in cols
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pytest tests/test_keywords.py -v
```

Expected: `ImportError` — `app.models.keyword` does not exist yet.

- [ ] **Step 3: Create the models file**

Create `backend/app/models/keyword.py`:

```python
from datetime import datetime, timezone
from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class UserKeywordBlocklist(Base):
    __tablename__ = "user_keyword_blocklist"
    __table_args__ = (UniqueConstraint("user_id", "term", name="uq_blocklist_user_term"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    term: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class ProfileKeywordSignal(Base):
    __tablename__ = "profile_keyword_signals"
    __table_args__ = (UniqueConstraint("profile_id", "ngram", name="uq_signal_profile_ngram"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("user_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ngram: Mapped[str] = mapped_column(String(200), nullable=False)
    hide_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    show_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && pytest tests/test_keywords.py::test_user_keyword_blocklist_columns tests/test_keywords.py::test_profile_keyword_signal_columns -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/keyword.py backend/tests/test_keywords.py
git commit -m "feat: add UserKeywordBlocklist and ProfileKeywordSignal ORM models"
```

---

## Task 2: Pydantic schemas

**Files:**
- Create: `backend/app/schemas/keyword.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_keywords.py`:

```python
from app.schemas.keyword import (
    BlocklistResponse,
    BlocklistAddRequest,
    SignalItem,
    SignalUpsertRequest,
)


def test_blocklist_response_has_terms():
    r = BlocklistResponse(terms=["sales", "driver"])
    assert r.terms == ["sales", "driver"]


def test_blocklist_add_request_has_term():
    r = BlocklistAddRequest(term="sales rep")
    assert r.term == "sales rep"


def test_signal_item_fields():
    s = SignalItem(ngram="data science", hide_count=3, show_count=1)
    assert s.ngram == "data science"
    assert s.hide_count == 3
    assert s.show_count == 1


def test_signal_upsert_request_is_list():
    r = SignalUpsertRequest(signals=[SignalItem(ngram="foo", hide_count=1, show_count=0)])
    assert len(r.signals) == 1
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pytest tests/test_keywords.py -k "schema or blocklist_response or add_request or signal_item or upsert" -v
```

Expected: `ImportError` — `app.schemas.keyword` does not exist yet.

- [ ] **Step 3: Create the schemas file**

Create `backend/app/schemas/keyword.py`:

```python
from pydantic import BaseModel, Field
from typing import List


class BlocklistResponse(BaseModel):
    terms: List[str]


class BlocklistAddRequest(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)


class SignalItem(BaseModel):
    ngram: str = Field(..., min_length=1, max_length=200)
    hide_count: int = Field(..., ge=0)
    show_count: int = Field(..., ge=0)


class SignalUpsertRequest(BaseModel):
    signals: List[SignalItem]
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd backend && pytest tests/test_keywords.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/keyword.py backend/tests/test_keywords.py
git commit -m "feat: add Pydantic schemas for keyword blocklist and signals"
```

---

## Task 3: Alembic migration

**Files:**
- Create: `backend/alembic/versions/a007_add_keyword_tables.py`

- [ ] **Step 1: Create the migration file**

Create `backend/alembic/versions/a007_add_keyword_tables.py`:

```python
"""add keyword blocklist and signal tables

Revision ID: a007_add_keyword_tables
Revises: a006_add_profile_to_job_analyses
Create Date: 2026-04-08
"""
from alembic import op
import sqlalchemy as sa

revision = "a007_add_keyword_tables"
down_revision = "a006_add_profile_to_job_analyses"
branch_labels = None
depends_on = None

BAD_FIT_KEYWORDS = [
    "sales representative", "recruiter", "truck driver", "diesel mechanic",
    "retail associate", "customer service representative", "customer success",
    "customer service", "retail", "driver", "technician", "diesel",
    "mechanic", "hvac", "plumber", "carpenter", "welder",
]


def upgrade() -> None:
    op.create_table(
        "user_keyword_blocklist",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("term", sa.String(200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "term", name="uq_blocklist_user_term"),
    )
    op.create_index("ix_user_keyword_blocklist_user_id", "user_keyword_blocklist", ["user_id"])

    op.create_table(
        "profile_keyword_signals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.Integer(),
            sa.ForeignKey("user_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ngram", sa.String(200), nullable=False),
        sa.Column("hide_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("show_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("profile_id", "ngram", name="uq_signal_profile_ngram"),
    )
    op.create_index("ix_profile_keyword_signals_profile_id", "profile_keyword_signals", ["profile_id"])

    # Seed existing users with the legacy hard-coded blocklist
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    for user in users:
        for term in BAD_FIT_KEYWORDS:
            conn.execute(
                sa.text(
                    "INSERT INTO user_keyword_blocklist (user_id, term) "
                    "VALUES (:uid, :term) ON CONFLICT DO NOTHING"
                ),
                {"uid": user.id, "term": term},
            )


def downgrade() -> None:
    op.drop_index("ix_profile_keyword_signals_profile_id", table_name="profile_keyword_signals")
    op.drop_table("profile_keyword_signals")
    op.drop_index("ix_user_keyword_blocklist_user_id", table_name="user_keyword_blocklist")
    op.drop_table("user_keyword_blocklist")
```

- [ ] **Step 2: Run the migration**

```bash
cd backend && alembic upgrade head
```

Expected: output ends with `Running upgrade a006_add_profile_to_job_analyses -> a007_add_keyword_tables`

- [ ] **Step 3: Commit**

```bash
git add backend/alembic/versions/a007_add_keyword_tables.py
git commit -m "feat: add migration for keyword blocklist and signal tables"
```

---

## Task 4: API routes

**Files:**
- Create: `backend/app/api/keywords.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_keywords.py`:

```python
import ast
import pathlib


def test_keywords_router_exists():
    src = pathlib.Path("app/api/keywords.py").read_text()
    tree = ast.parse(src)
    names = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    assert "get_blocklist" in names
    assert "add_to_blocklist" in names
    assert "remove_from_blocklist" in names
    assert "get_signals" in names
    assert "upsert_signals" in names


def test_keywords_router_registered_in_main():
    src = pathlib.Path("app/main.py").read_text()
    assert "keywords_router" in src or "keywords" in src
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && pytest tests/test_keywords.py::test_keywords_router_exists tests/test_keywords.py::test_keywords_router_registered_in_main -v
```

Expected: FAIL — `app/api/keywords.py` does not exist.

- [ ] **Step 3: Create the API routes file**

Create `backend/app/api/keywords.py`:

```python
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.user_profile import UserProfile
from app.models.keyword import UserKeywordBlocklist, ProfileKeywordSignal
from app.schemas.keyword import BlocklistResponse, BlocklistAddRequest, SignalItem, SignalUpsertRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/blocklist", response_model=BlocklistResponse)
def get_blocklist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BlocklistResponse:
    rows = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id)
        .order_by(UserKeywordBlocklist.created_at)
        .all()
    )
    return BlocklistResponse(terms=[r.term for r in rows])


@router.post("/blocklist", status_code=201)
def add_to_blocklist(
    body: BlocklistAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    term = body.term.strip().lower()
    existing = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id, UserKeywordBlocklist.term == term)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Term already in blocklist")
    entry = UserKeywordBlocklist(user_id=current_user.id, term=term)
    db.add(entry)
    db.commit()
    logger.info("Added blocklist term '%s' for user %d", term, current_user.id)
    return {"term": term}


@router.delete("/blocklist/{term}", status_code=204)
def remove_from_blocklist(
    term: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    entry = (
        db.query(UserKeywordBlocklist)
        .filter(UserKeywordBlocklist.user_id == current_user.id, UserKeywordBlocklist.term == term)
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Term not found")
    db.delete(entry)
    db.commit()
    logger.info("Removed blocklist term '%s' for user %d", term, current_user.id)


@router.get("/signals/{profile_id}", response_model=list[SignalItem])
def get_signals(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SignalItem]:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    rows = (
        db.query(ProfileKeywordSignal)
        .filter(ProfileKeywordSignal.profile_id == profile_id)
        .all()
    )
    return [SignalItem(ngram=r.ngram, hide_count=r.hide_count, show_count=r.show_count) for r in rows]


@router.put("/signals/{profile_id}", status_code=204)
def upsert_signals(
    profile_id: int,
    body: SignalUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    profile = (
        db.query(UserProfile)
        .filter(UserProfile.id == profile_id, UserProfile.user_id == current_user.id)
        .first()
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    now = datetime.now(timezone.utc)
    for item in body.signals:
        existing = (
            db.query(ProfileKeywordSignal)
            .filter(
                ProfileKeywordSignal.profile_id == profile_id,
                ProfileKeywordSignal.ngram == item.ngram,
            )
            .first()
        )
        if existing:
            existing.hide_count = item.hide_count
            existing.show_count = item.show_count
            existing.updated_at = now
        else:
            db.add(ProfileKeywordSignal(
                profile_id=profile_id,
                ngram=item.ngram,
                hide_count=item.hide_count,
                show_count=item.show_count,
                updated_at=now,
            ))
    db.commit()
    logger.info("Upserted %d signals for profile %d", len(body.signals), profile_id)
```

- [ ] **Step 4: Register the router in main.py**

In `backend/app/main.py`, add after the existing imports and router registrations:

```python
from app.api.keywords import router as keywords_router
```

And after `app.include_router(profiles_router, ...)`:

```python
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])
```

The full `main.py` imports block becomes:
```python
from app.api.analyze import router as analyze_router
from app.api.auth import router as auth_router
from app.api.reach import router as reach_router
from app.api.profiles import router as profiles_router
from app.api.keywords import router as keywords_router
```

And the router registrations:
```python
app.include_router(analyze_router, prefix="/api/v1", tags=["analysis"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(reach_router, prefix="/api/v1/reach", tags=["reach"])
app.include_router(profiles_router, prefix="/api/v1/profiles", tags=["profiles"])
app.include_router(keywords_router, prefix="/api/v1/keywords", tags=["keywords"])
```

- [ ] **Step 5: Run all keyword tests**

```bash
cd backend && pytest tests/test_keywords.py -v
```

Expected: all 10 tests PASS

- [ ] **Step 6: Smoke-test the API**

With the backend running (`uvicorn app.main:app --reload`), check the OpenAPI docs include the new routes:

```bash
curl http://localhost:8000/openapi.json | python -m json.tool | grep "/keywords"
```

Expected: `/api/v1/keywords/blocklist`, `/api/v1/keywords/signals/{profile_id}` appear.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/keywords.py backend/app/main.py backend/tests/test_keywords.py
git commit -m "feat: add keyword blocklist and signal API endpoints"
```

---

## Task 5: Background — seed on login and clear on logout

**Files:**
- Modify: `extension/src/background/index.ts`

The background script needs three new async helper functions (`seedBlocklist`, `seedSignals`, `seedKeywordData`), an updated `LOGIN` handler that calls `seedKeywordData` after storing the JWT, and an updated `LOGOUT` handler that calls `chrome.storage.local.clear()` instead of only removing `auth_jwt`.

- [ ] **Step 1: Add seed helpers to background/index.ts**

After the `handle401` function (line 28), add:

```typescript
async function seedBlocklist(): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/blocklist`, { headers });
    if (!r.ok) return;
    const data: { terms: string[] } = await r.json();
    chrome.storage.local.set({ blocklist: data.terms });
  } catch (err) {
    console.error("[JobScout BG] Failed to seed blocklist:", err);
  }
}

async function seedSignals(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/signals/${profileId}`, { headers });
    if (!r.ok) return;
    const signals: Array<{ ngram: string; hide_count: number; show_count: number }> = await r.json();
    const updates: Record<string, number> = {};
    for (const sig of signals) {
      updates[`kw_hide_${sig.ngram}`] = sig.hide_count;
      updates[`kw_show_${sig.ngram}`] = sig.show_count;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed signals:", err);
  }
}

async function seedKeywordData(): Promise<void> {
  await seedBlocklist();
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/profiles/active`, { headers });
    if (!r.ok) return;
    const profile: { id: number; name: string } | null = await r.json();
    if (!profile) return;
    chrome.storage.local.set({ active_profile_id: profile.id });
    await seedSignals(profile.id);
  } catch (err) {
    console.error("[JobScout BG] Failed to seed keyword data:", err);
  }
}
```

- [ ] **Step 2: Update the LOGIN handler**

Find the `LOGIN` handler block. Replace:

```typescript
  if (message.type === "LOGIN") {
    fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: message.email, password: message.password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.detail || "Login failed");
        chrome.storage.local.set({ auth_jwt: data.access_token });
        sendResponse({ success: true, hasApiKey: data.has_api_key });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
```

With:

```typescript
  if (message.type === "LOGIN") {
    fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: message.email, password: message.password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.detail || "Login failed");
        chrome.storage.local.set({ auth_jwt: data.access_token });
        sendResponse({ success: true, hasApiKey: data.has_api_key });
        // Fire-and-forget: seed keyword data after login
        seedKeywordData();
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
```

- [ ] **Step 3: Update the LOGOUT handler**

Find the `LOGOUT` handler block. Replace:

```typescript
  if (message.type === "LOGOUT") {
    chrome.storage.local.remove("auth_jwt");
    sendResponse({ success: true });
    return true;
  }
```

With:

```typescript
  if (message.type === "LOGOUT") {
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }
```

- [ ] **Step 4: Build and reload the extension**

```bash
cd extension && pnpm build
```

Then in Chrome: `chrome://extensions` → reload the JobScout extension.

- [ ] **Step 5: Smoke-test login seeding**

1. Open the extension popup and log in.
2. Open Chrome DevTools → Application → Local Storage → Extension.
3. Verify `blocklist` key exists as an array, `active_profile_id` is a number (if you have an active profile), and `kw_hide_*` / `kw_show_*` keys appear if you have existing signal data.

- [ ] **Step 6: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: seed blocklist and signals from backend on login, clear storage on logout"
```

---

## Task 6: Background — SWITCH_PROFILE handler and debounced sync

**Files:**
- Modify: `extension/src/background/index.ts`

- [ ] **Step 1: Add dirty-set state and debounce flush to background/index.ts**

After the `seedKeywordData` function, add:

```typescript
// ===== SIGNAL SYNC =====

const dirtyNgrams = new Set<string>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 30_000;

function scheduleSyncSignals(): void {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    flushSignals();
  }, SYNC_DEBOUNCE_MS);
}

async function flushSignals(): Promise<void> {
  if (dirtyNgrams.size === 0) return;
  const toFlush = Array.from(dirtyNgrams);
  dirtyNgrams.clear();

  const hideKeys = toFlush.map((ng) => `kw_hide_${ng}`);
  const showKeys = toFlush.map((ng) => `kw_show_${ng}`);

  chrome.storage.local.get(["active_profile_id", ...hideKeys, ...showKeys], async (data) => {
    const profileId = data["active_profile_id"] as number | undefined;
    if (!profileId) return;

    const payload = toFlush.map((ng) => ({
      ngram: ng,
      hide_count: (data[`kw_hide_${ng}`] as number) ?? 0,
      show_count: (data[`kw_show_${ng}`] as number) ?? 0,
    }));

    const headers = await getAuthHeaders();
    fetch(`${BACKEND_URL}/keywords/signals/${profileId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ signals: payload }),
    }).catch((err) => console.error("[JobScout BG] Signal sync failed:", err));
  });
}

// Watch for kw_* changes written by the content script
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(changes)) {
    if (key.startsWith("kw_hide_") || key.startsWith("kw_show_")) {
      dirtyNgrams.add(key.replace(/^kw_(?:hide|show)_/, ""));
    }
  }
  if (dirtyNgrams.size > 0) scheduleSyncSignals();
});

// Flush on service worker shutdown
chrome.runtime.onSuspend.addListener(() => {
  if (syncTimer !== null) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  flushSignals();
});
```

- [ ] **Step 2: Add the SWITCH_PROFILE message handler**

Inside the `chrome.runtime.onMessage.addListener` callback, add before the final closing brace:

```typescript
  if (message.type === "SWITCH_PROFILE") {
    // Flush pending signals for the outgoing profile first
    if (syncTimer !== null) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    flushSignals().then(async () => {
      // Clear all kw_* keys from local storage
      chrome.storage.local.get(null, async (items) => {
        const keysToRemove = Object.keys(items).filter(
          (k) => k.startsWith("kw_hide_") || k.startsWith("kw_show_"),
        );
        if (keysToRemove.length > 0) {
          await new Promise<void>((resolve) =>
            chrome.storage.local.remove(keysToRemove, resolve),
          );
        }

        // Store new active profile and seed its signals
        chrome.storage.local.set({ active_profile_id: message.profileId });
        await seedSignals(message.profileId as number);

        // Notify all content scripts
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: "PROFILE_SWITCHED" }).catch(() => {});
            }
          });
        });

        sendResponse({ success: true });
      });
    });
    return true;
  }
```

- [ ] **Step 3: Build and reload the extension**

```bash
cd extension && pnpm build
```

Reload in Chrome: `chrome://extensions` → reload JobScout.

- [ ] **Step 4: Commit**

```bash
git add extension/src/background/index.ts
git commit -m "feat: add SWITCH_PROFILE handler and debounced signal sync to background"
```

---

## Task 7: Dashboard — send SWITCH_PROFILE on profile activation

**Files:**
- Modify: `extension/src/dashboard/index.ts`

The `activateProfileById` function in the dashboard calls `POST /profiles/{id}/activate` but doesn't notify the background service worker. After a successful activation, it must send a `SWITCH_PROFILE` message so the background can re-seed signals.

- [ ] **Step 1: Find and update activateProfileById**

In `extension/src/dashboard/index.ts`, find:

```typescript
async function activateProfileById(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to activate profile");
}
```

Replace with:

```typescript
async function activateProfileById(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to activate profile");
  // Notify background to re-seed keyword signals for the new profile
  chrome.runtime.sendMessage({ type: "SWITCH_PROFILE", profileId: id }).catch(() => {});
}
```

- [ ] **Step 2: Build and reload**

```bash
cd extension && pnpm build
```

Reload in Chrome.

- [ ] **Step 3: Smoke-test profile switching**

1. Open the dashboard → Profiles tab.
2. Activate a different profile.
3. Open DevTools → Application → Extension storage.
4. Verify `active_profile_id` updates and `kw_*` keys are replaced with the new profile's signals (or cleared if no signals yet).

- [ ] **Step 4: Commit**

```bash
git add extension/src/dashboard/index.ts
git commit -m "feat: send SWITCH_PROFILE to background after profile activation"
```

---

## Task 8: Content script — blocklist variable and PROFILE_SWITCHED handler

**Files:**
- Modify: `extension/src/content/index.ts`

- [ ] **Step 1: Replace BAD_FIT_KEYWORDS with a seeded module variable**

In `extension/src/content/index.ts`, find and delete the entire `BAD_FIT_KEYWORDS` array (lines 54–72):

```typescript
const BAD_FIT_KEYWORDS = [
  "sales representative",
  "recruiter",
  "truck driver",
  "diesel mechanic",
  "retail associate",
  "customer service representative",
  "customer success",
  "customer service",
  "retail",
  "driver",
  "technician",
  "diesel",
  "mechanic",
  "hvac",
  "plumber",
  "carpenter",
  "welder",
];
```

Replace with:

```typescript
// Blocklist is seeded from the backend by the background service worker on login.
// The background writes it to chrome.storage.local as `blocklist: string[]`.
let blocklist: string[] = [];

// Load initial value from storage
chrome.storage.local.get("blocklist", (data) => {
  blocklist = (data.blocklist as string[]) ?? [];
});

// Keep it updated if background refreshes it (login, profile switch, settings edit)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["blocklist"]) {
    blocklist = (changes["blocklist"].newValue as string[]) ?? [];
  }
});
```

- [ ] **Step 2: Update shouldKeywordDim to use the blocklist variable**

Find:

```typescript
function shouldKeywordDim(title: string): boolean {
  const lower = title.toLowerCase();
  return BAD_FIT_KEYWORDS.some((kw) => lower.includes(kw));
}
```

Replace with:

```typescript
function shouldKeywordDim(title: string): boolean {
  const lower = title.toLowerCase();
  return blocklist.some((kw) => lower.includes(kw));
}
```

- [ ] **Step 3: Add PROFILE_SWITCHED message listener**

At the bottom of `extension/src/content/index.ts`, before the `export {};` line, add:

```typescript
// Re-evaluate all visible cards when the active profile changes
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PROFILE_SWITCHED") {
    console.log("[JobScout] Profile switched — re-evaluating cards");
    reEvaluateAllCards();
  }
});
```

- [ ] **Step 4: Build and reload**

```bash
cd extension && pnpm build
```

Reload in Chrome.

- [ ] **Step 5: Smoke-test**

1. Browse to LinkedIn jobs.
2. Verify cards are still being dimmed (blocklist loaded from storage).
3. Manually hide a card — verify the kw_* signal keys update in DevTools storage.
4. Wait 30s and verify the background flushes to `PUT /keywords/signals/{profileId}` (check backend logs or Network tab in an extension background inspector).

- [ ] **Step 6: Commit**

```bash
git add extension/src/content/index.ts
git commit -m "feat: replace BAD_FIT_KEYWORDS with storage-seeded blocklist, handle PROFILE_SWITCHED"
```

---

## Task 9: Settings page — Keyword Filters tab

**Files:**
- Modify: `backend/app/static/web/settings.html`
- Modify: `backend/app/static/web/settings.js`
- Modify: `backend/app/static/web/style.css`

### Part A: CSS

- [ ] **Step 1: Add tab and keyword list styles to style.css**

At the end of the `/* ── Settings page ── */` section in `backend/app/static/web/style.css`, append:

```css
.settings-tabs { display: flex; gap: 4px; max-width: 640px; margin: 24px auto 0; padding: 0 24px; }
.settings-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 16px; font-size: 13px; font-weight: 500; color: var(--text-muted); cursor: pointer; }
.settings-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.settings-tab:hover:not(.active) { color: var(--text); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

.keyword-input-row { display: flex; gap: 10px; margin-bottom: 16px; }
.keyword-input-row input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 12px; color: var(--text); font-size: 13px; }
.keyword-list { list-style: none; padding: 0; margin: 0; }
.keyword-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.keyword-item:last-child { border-bottom: none; }
.keyword-item-empty { font-size: 13px; color: var(--text-muted); padding: 12px 0; }
.btn-remove-keyword { background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px; }
.btn-remove-keyword:hover { color: var(--red); background: rgba(233,69,96,0.1); }
```

### Part B: HTML

- [ ] **Step 2: Restructure settings.html to use tabs**

Replace the entire `<body>` content of `backend/app/static/web/settings.html` with:

```html
<body>
<div class="header">
  <div class="header-left">
    <div class="logo-badge">JS</div>
    <span class="header-title">Settings</span>
  </div>
  <div class="header-right">
    <span class="user-email" id="user-email"></span>
    <a href="dashboard.html" class="btn-secondary">← Dashboard</a>
    <button class="btn-secondary" id="btn-logout">Sign Out</button>
  </div>
</div>

<div id="new-user-banner" class="hidden" style="background:rgba(74,158,255,0.1);border:1px solid rgba(74,158,255,0.3);border-radius:8px;padding:14px 18px;margin:20px auto 0;max-width:640px;font-size:13px;color:#4a9eff;">
  Welcome to JobScout! Add your Anthropic API key below to start analyzing jobs.
</div>

<div class="settings-tabs">
  <button class="settings-tab active" data-tab="account">Account</button>
  <button class="settings-tab" data-tab="keyword-filters">Keyword Filters</button>
</div>

<div id="tab-account" class="settings-content tab-panel active">
  <!-- API Key card -->
  <div class="settings-card">
    <h2>Anthropic API Key</h2>
    <p class="card-desc">Your own API key is required for job analysis, interview prep, and company research. Get yours at <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>.</p>
    <div id="api-key-error" class="error-msg hidden"></div>
    <div id="api-key-success" class="success-msg hidden">API key saved successfully.</div>
    <div class="api-key-row">
      <div class="field">
        <label>API Key</label>
        <input type="password" id="api-key-input" placeholder="sk-ant-api03-…" autocomplete="off">
      </div>
      <button class="btn-save" id="btn-save-key">Save</button>
    </div>
    <div id="key-status" style="margin-top:12px;font-size:12px;color:var(--text-muted)"></div>
  </div>

  <!-- Account info card -->
  <div class="settings-card">
    <h2>Account</h2>
    <div class="info-row"><span class="info-label">Email</span><span id="info-email">—</span></div>
    <div class="info-row"><span class="info-label">Member since</span><span id="info-since">—</span></div>
  </div>
</div>

<div id="tab-keyword-filters" class="settings-content tab-panel">
  <div class="settings-card">
    <h2>Keyword Filters</h2>
    <p class="card-desc">Job cards with titles containing these terms will be automatically dimmed. Changes apply the next time you browse a job site.</p>
    <div class="keyword-input-row">
      <input type="text" id="keyword-input" placeholder="e.g. sales representative" autocomplete="off">
      <button class="btn-save" id="btn-add-keyword">Add</button>
    </div>
    <div id="keyword-error" class="error-msg hidden"></div>
    <ul id="keyword-list" class="keyword-list"></ul>
  </div>
</div>

<script src="settings.js"></script>
</body>
```

### Part C: JavaScript

- [ ] **Step 3: Add tab switching and blocklist CRUD to settings.js**

Append to the end of `backend/app/static/web/settings.js`:

```javascript
// ── Tab switching ──
document.querySelectorAll('.settings-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'keyword-filters') loadBlocklist();
  });
});

// ── Keyword Filters ──
var blocklistTerms = [];

async function loadBlocklist() {
  const r = await authFetch('/api/v1/keywords/blocklist');
  if (!r) return;
  const data = await r.json();
  blocklistTerms = data.terms || [];
  renderBlocklist();
}

function renderBlocklist() {
  const list = document.getElementById('keyword-list');
  if (blocklistTerms.length === 0) {
    list.innerHTML = '<li class="keyword-item-empty">No keyword filters yet. Add one above.</li>';
    return;
  }
  list.innerHTML = blocklistTerms.map(function(term) {
    return '<li class="keyword-item"><span>' + term + '</span>'
      + '<button class="btn-remove-keyword" data-term="' + term.replace(/"/g, '&quot;') + '">×</button></li>';
  }).join('');
}

document.getElementById('btn-add-keyword').addEventListener('click', async function() {
  const input = document.getElementById('keyword-input');
  const term = input.value.trim().toLowerCase();
  const errEl = document.getElementById('keyword-error');
  errEl.classList.add('hidden');

  if (!term) return;
  if (blocklistTerms.includes(term)) {
    errEl.textContent = 'That term is already in your list.';
    errEl.classList.remove('hidden');
    return;
  }

  // Optimistic update
  blocklistTerms.unshift(term);
  renderBlocklist();
  input.value = '';

  const r = await authFetch('/api/v1/keywords/blocklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: term }),
  });
  if (!r || !r.ok) {
    blocklistTerms = blocklistTerms.filter(function(t) { return t !== term; });
    renderBlocklist();
    errEl.textContent = 'Failed to add keyword. Please try again.';
    errEl.classList.remove('hidden');
  }
});

document.getElementById('keyword-list').addEventListener('click', async function(e) {
  const btn = e.target.closest('.btn-remove-keyword');
  if (!btn) return;
  const term = btn.dataset.term;

  // Optimistic update
  const prev = blocklistTerms.slice();
  blocklistTerms = blocklistTerms.filter(function(t) { return t !== term; });
  renderBlocklist();

  const r = await authFetch('/api/v1/keywords/blocklist/' + encodeURIComponent(term), { method: 'DELETE' });
  if (!r || !r.ok) {
    blocklistTerms = prev;
    renderBlocklist();
  }
});
```

- [ ] **Step 4: Smoke-test the settings page**

1. Open `http://localhost:8000/settings.html` and log in.
2. Click "Keyword Filters" tab — verify the list loads with your seeded terms.
3. Add a new term — verify it appears at the top of the list and a `POST /api/v1/keywords/blocklist` call succeeds.
4. Remove a term — verify it disappears and a `DELETE` call succeeds.
5. Switch back to "Account" tab — verify the account page still works.

- [ ] **Step 5: Commit**

```bash
git add backend/app/static/web/settings.html backend/app/static/web/settings.js backend/app/static/web/style.css
git commit -m "feat: add Keyword Filters tab to settings page for per-user blocklist management"
```

---

## Self-Review Notes

- The `PUT /keywords/signals/{profile_id}` endpoint receives `{ signals: [...] }` (a `SignalUpsertRequest` body). The background `flushSignals()` sends `{ signals: payload }` — this matches.
- `chrome.storage.local.clear()` on logout wipes `auth_jwt` along with all other keys, which is the intent.
- `PROFILE_SWITCHED` broadcast from background is only sent after `seedSignals` completes, so content script re-evaluates cards with the new profile's data already in storage.
- The `DELETE /keywords/blocklist/{term}` path parameter receives URL-decoded terms from FastAPI automatically (e.g., `%20` → space). The JS side uses `encodeURIComponent(term)` to encode spaces before sending.
- `settings.js` uses `var` and plain functions to stay consistent with the existing code style in that file, which avoids a build step.
- The `tab-panel` class uses `display: none` / `display: block` via `.active` class rather than the existing `.hidden` class, to avoid needing to override `!important`.
