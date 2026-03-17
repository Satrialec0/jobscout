import json
import re
import anthropic
from app.config import get_settings
from app.schemas.analyze import AnalyzeResponse, ScoreCategory

print("[claude.py] Loading Claude service module")

SYSTEM_PROMPT = """You are an expert job application strategist analyzing job fit for a specific candidate.

CANDIDATE PROFILE:
- Name: Christopher
- Current Role: Project Design Engineer at Hanwha Qcells USA Corp (utility-scale solar PV + BESS, 200MW+ projects)
- Core Competencies:
  - Electrical systems design (NEC-compliant), single-line diagrams, equipment sizing
  - Solar production modeling: PVsyst, SAM
  - RFP review, proposal development, cross-functional project coordination
  - Internal tooling and automation: Python, C#/.NET, Excel VBA
  - Data engineering (ETL pipelines, PostgreSQL, API integrations)
- Education: BS Electrical & Computer Engineering, Rowan University (2020)
- Background: Prior MEP electrical design experience at Barile Gallagher and WSP before transitioning to solar in 2023
- Target Roles: Solutions Engineer, Technical Project Manager, Product Manager, or adjacent clean energy / energy tech roles
- Key Career Theme: Bridging deep technical expertise with project ownership, stakeholder communication, and product/commercial thinking

SCORING INSTRUCTIONS:
Analyze the job description and return ONLY a valid JSON object with no markdown, no code blocks, no explanation.
The JSON must exactly match this schema:
{
  "fit_score": <integer 0-100>,
  "should_apply": <boolean>,
  "one_line_verdict": "<one sentence max>",
  "direct_matches": [{"item": "<skill/experience>", "detail": "<why it matches>"}],
  "transferable": [{"item": "<skill/experience>", "detail": "<how to reframe>"}],
  "gaps": [{"item": "<missing requirement>", "detail": "<honest assessment>"}],
  "red_flags": ["<concerning aspect of the role>"],
  "green_flags": ["<strong positive signal>"]
}

SCORING RUBRIC:
- 80-100: Strong match, apply immediately
- 60-79: Good match with some gaps, worth applying
- 40-59: Partial match, apply only if role is high priority
- Below 40: Significant gaps, not recommended

Be honest about gaps. Do not oversell. Flag real mismatches."""


def parse_claude_response(raw_text: str) -> AnalyzeResponse:
    print(f"[claude.py] Parsing raw response, length: {len(raw_text)} chars")

    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()
        print("[claude.py] Stripped markdown code block from response")

    data = json.loads(cleaned)
    print(f"[claude.py] JSON parsed successfully, fit_score: {data.get('fit_score')}")

    return AnalyzeResponse(
        fit_score=data["fit_score"],
        should_apply=data["should_apply"],
        one_line_verdict=data["one_line_verdict"],
        direct_matches=[ScoreCategory(**i) for i in data.get("direct_matches", [])],
        transferable=[ScoreCategory(**i) for i in data.get("transferable", [])],
        gaps=[ScoreCategory(**i) for i in data.get("gaps", [])],
        red_flags=data.get("red_flags", []),
        green_flags=data.get("green_flags", []),
    )


def analyze_job(job_title: str, company: str, job_description: str) -> AnalyzeResponse:
    print(f"[claude.py] Starting analysis for: {job_title} at {company}")

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    user_message = f"""Please analyze this job posting for fit:

JOB TITLE: {job_title}
COMPANY: {company}

JOB DESCRIPTION:
{job_description}"""

    print("[claude.py] Sending request to Claude API")

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[
            {"role": "user", "content": user_message}
        ]
    )

    print(f"[claude.py] Claude response received, stop_reason: {message.stop_reason}")

    raw_text = message.content[0].text
    return parse_claude_response(raw_text)