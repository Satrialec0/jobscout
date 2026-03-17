# JobScout

A full-stack browser extension that analyzes job listings in real time and scores your fit using Claude AI. Built as a portfolio project to demonstrate full-stack development across a Python backend, PostgreSQL database, Chrome extension, and LLM integration.

![JobScout Demo](docs/demo.png)

## What it does

As you browse job listings on LinkedIn, JobScout automatically extracts the job description, sends it to a local backend, and scores your fit against a detailed candidate profile using Claude. Results appear in a popup with a fit score, apply recommendation, matched skills, transferable experience, gaps, and flags — without leaving the page.

- **Automatic scoring** — triggers on every new job listing as you click through LinkedIn
- **Cached results** — previously scored jobs return instantly with no API call
- **Structured analysis** — direct matches, transferable skills, gaps, and red/green flags
- **Job history** — every scored job saved to PostgreSQL for later review

## Architecture

```
Chrome Extension (Manifest V3 + TypeScript)
├── Content script     → Extracts job data from LinkedIn DOM
├── Background worker  → Routes API calls outside LinkedIn's CSP
└── Popup UI           → Displays score ring, verdict, and breakdown

FastAPI Backend (Python)
├── /api/v1/analyze    → Scores a job description via Claude API
├── /api/v1/history    → Returns previously scored jobs
└── /health            → Health check

PostgreSQL Database
└── job_analyses       → Cached scores, full breakdown, timestamps

Claude API (claude-sonnet-4-20250514)
└── Structured JSON output with fit_score, matches, gaps, flags
```

## Tech stack

| Layer              | Technology                       |
| ------------------ | -------------------------------- |
| Browser extension  | TypeScript, Manifest V3, Webpack |
| Backend framework  | Python, FastAPI, Uvicorn         |
| AI integration     | Anthropic Claude API             |
| Database           | PostgreSQL 16, SQLAlchemy ORM    |
| Migrations         | Alembic                          |
| Data validation    | Pydantic v2                      |
| Containerization   | Docker, Docker Compose           |
| Package management | uv (Python), pnpm (Node)         |

## Project structure

```
jobscout/
├── backend/
│   ├── app/
│   │   ├── api/           # Route handlers
│   │   ├── models/        # SQLAlchemy ORM models + repository pattern
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # Claude API client and scoring logic
│   │   ├── prompts/       # System prompt templates
│   │   ├── config.py      # Environment-based settings
│   │   ├── database.py    # Session management
│   │   └── main.py        # FastAPI app + middleware
│   ├── alembic/           # Database migrations
│   ├── tests/             # pytest test suite
│   └── requirements.txt
├── extension/
│   ├── src/
│   │   ├── content/       # DOM scraper + URL watcher
│   │   ├── background/    # Service worker + backend relay
│   │   └── popup/         # Score display UI
│   ├── public/            # manifest.json + popup.html
│   └── webpack.config.js
└── docker-compose.yml
```

## Key engineering decisions

**Background worker as CSP bypass** — LinkedIn's Content Security Policy blocks outbound fetch calls from page-injected scripts. The content script extracts job data and passes it via `chrome.runtime.sendMessage` to the background service worker, which runs in the extension's own context and is not subject to the page's CSP.

**SPA URL watcher** — LinkedIn is a single-page application. Rather than relying on page load events, a persistent `MutationObserver` monitors DOM changes and detects URL transitions, triggering a fresh analysis cycle on each new job without requiring a page reload.

**Repository pattern** — Database logic is separated from API route handlers via a repository layer, keeping the route handlers thin and the data access logic testable in isolation.

**URL-based caching** — Analyzed jobs are cached in PostgreSQL keyed by URL. Repeat visits to the same listing return instantly with zero API cost.

**Structured LLM output** — The Claude prompt specifies an exact JSON schema with strict field requirements. The scoring service validates and parses the response into typed Pydantic models, ensuring the extension always receives machine-readable data regardless of model output variation.

## Local setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker Desktop
- Chrome browser
- Anthropic API key

### Backend

```bash
# Start PostgreSQL
docker compose up -d

# Install dependencies
cd backend
uv venv
.venv\Scripts\Activate.ps1     # Windows
source .venv/bin/activate       # macOS/Linux
uv pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

API docs available at `http://127.0.0.1:8000/docs`

### Chrome extension

```bash
cd extension
pnpm install
pnpm build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist/`
4. Navigate to any LinkedIn job listing

### Running both together

Keep the backend running in one terminal and the extension loaded in Chrome. The extension connects to `http://127.0.0.1:8000` automatically.

## API reference

### POST /api/v1/analyze

Scores a job description against the candidate profile.

**Request:**

```json
{
  "job_title": "Solutions Engineer",
  "company": "Nexamp",
  "job_description": "...",
  "url": "https://linkedin.com/jobs/view/..."
}
```

**Response:**

```json
{
  "fit_score": 85,
  "should_apply": true,
  "one_line_verdict": "Strong match leveraging solar experience and RFP expertise.",
  "direct_matches": [{ "item": "...", "detail": "..." }],
  "transferable": [{ "item": "...", "detail": "..." }],
  "gaps": [{ "item": "...", "detail": "..." }],
  "red_flags": ["..."],
  "green_flags": ["..."]
}
```

### GET /api/v1/history

Returns previously scored jobs ordered by most recent.

**Query params:** `limit` (default: 20)

## Scoring rubric

| Score    | Recommendation                              |
| -------- | ------------------------------------------- |
| 80–100   | Strong match — apply immediately            |
| 60–79    | Good match with minor gaps — worth applying |
| 40–59    | Partial match — apply only if high priority |
| Below 40 | Significant gaps — not recommended          |

## Roadmap

- [ ] Score badge injected inline on LinkedIn job cards
- [ ] Indeed and Hiring.cafe DOM scrapers
- [ ] Dashboard UI for browsing job history with filters
- [ ] Export scored jobs to CSV
- [ ] Configurable candidate profile via settings UI
- [ ] Test suite with pytest + httpx

## License

MIT
