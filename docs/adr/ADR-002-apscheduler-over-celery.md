# ADR-002: APScheduler + asyncio.gather Over Celery for Background Polling

**Status:** Accepted
**Date:** 2026-04-12

## Context

The backend needs to poll hiring.cafe every hour per user. A task scheduling mechanism is required. The two realistic options are APScheduler (runs inside the FastAPI process) and Celery (distributed task queue with Redis broker).

## Decision

Use APScheduler running inside the FastAPI process, with `asyncio.gather()` to run each user's saved searches concurrently within a single scheduled task.

## Alternatives Considered

**Celery + Redis:** Industry-standard distributed task queue. Supports horizontal scaling, task retries, dead letter queues, priority queues, and real-time monitoring (Flower). Requires a Redis container alongside FastAPI and PostgreSQL, a separate Celery worker process, and meaningful operational overhead to configure and maintain.

**Cron job (OS-level):** Simple but requires the scheduler to live outside the application, complicates deployment, and doesn't integrate naturally with FastAPI's async context and database sessions.

**Cloud scheduler (e.g. Cloudflare Cron Triggers):** Would require the scraper logic to be exposed as an HTTP endpoint and triggered externally. Adds network round-trip and complicates auth. Not necessary given the backend is always running.

## Consequences

**Positive:**
- Zero new infrastructure — no Redis container, no Celery worker process, no changes to Docker Compose.
- APScheduler integrates directly with FastAPI's async context. Database sessions and application state are immediately available.
- `asyncio.gather()` provides true concurrent execution of all saved searches per user with no additional complexity — a user's 3 searches complete in ~2 seconds total rather than ~6 seconds sequentially.
- Per-user poll staggering (`user_id % 60` minute offset) distributes load across the hour organically.
- Exceptions in individual search tasks are caught via `return_exceptions=True` — one failing search does not abort others.

**Negative:**
- APScheduler runs in the same process as FastAPI. A scheduler crash could theoretically affect the API and vice versa. In practice, APScheduler exceptions are caught and logged without propagating to the API layer.
- Does not support horizontal scaling — if the backend is ever load-balanced across multiple instances, every instance runs the scheduler independently. At that scale, Celery becomes the right answer.
- No built-in monitoring dashboard (unlike Flower for Celery). Scheduler activity is observable via structured logging.

**Migration path:**
APScheduler tasks are isolated in `backend/app/services/scraper.py`. Migrating to Celery when needed requires extracting these functions as Celery tasks — a bounded, mechanical change. The decision to start with APScheduler does not foreclose Celery later.
