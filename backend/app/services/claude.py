import json
import re
import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.config import get_settings
from app.schemas.analyze import AnalyzeResponse, ScoreCategory, SalaryEstimate

logger = logging.getLogger(__name__)

_BASE_PROMPT = """You are an expert job application strategist analyzing job fit for a specific candidate.

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
  "green_flags": ["<strong positive signal>"],
  "salary_estimate": {
    "low": <integer, annual USD>,
    "high": <integer, annual USD>,
    "currency": "USD",
    "per": "year",
    "confidence": "<low|medium|high>",
    "assessment": "<one sentence comparing to listed salary, or null if no listed salary>"
  }
}

SALARY ESTIMATION INSTRUCTIONS:
- Always provide a salary_estimate based on: job title, seniority, company type/size, location signals, industry, and required experience
- Base estimates on current US market rates for 2025-2026
- If the job description lists a salary, set assessment to a one-sentence evaluation of whether it is below market, at market, or above market for this role and location
- If no salary is listed, set assessment to null
- Use these rough anchors for clean energy / engineering roles in the Northeast US:
  - Entry level (0-2 yrs): $65k-$85k
  - Mid level (3-5 yrs): $85k-$120k
  - Senior (5-8 yrs): $110k-$150k
  - Staff/Lead (8+ yrs): $140k-$200k
  - Adjust up 15-25% for NYC/SF, down 10-15% for remote or midwest roles
  - Adjust up for specialized skills (PE license, specific software, niche domain)
  - Adjust up for product/commercial roles vs pure engineering roles
- confidence should be "high" if the JD gives strong signals (title, location, years experience), "medium" if partial signals, "low" if minimal context

SCORING RUBRIC:
- 80-100: Strong match, apply immediately
- 60-79: Good match with some gaps, worth applying
- 40-59: Partial match, apply only if role is high priority
- Below 40: Significant gaps, not recommended

Be honest about gaps. Do not oversell. Flag real mismatches."""


def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""


def _strip_markdown(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    return cleaned.strip()


def _parse_response(raw_text: str, listed_salary: str | None = None) -> AnalyzeResponse:
    cleaned = _strip_markdown(raw_text)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Claude response as JSON: %s", e)
        logger.debug("Raw response was: %s", raw_text)
        raise ValueError(f"Claude returned invalid JSON: {e}") from e

    salary_estimate = None
    if data.get("salary_estimate"):
        se = data["salary_estimate"]
        try:
            salary_estimate = SalaryEstimate(
                low=se["low"],
                high=se["high"],
                currency=se.get("currency", "USD"),
                per=se.get("per", "year"),
                confidence=se.get("confidence", "medium"),
                assessment=se.get("assessment"),
            )
        except (KeyError, TypeError) as e:
            logger.warning("Could not parse salary_estimate: %s", e)

    try:
        return AnalyzeResponse(
            fit_score=data["fit_score"],
            should_apply=data["should_apply"],
            one_line_verdict=data["one_line_verdict"],
            direct_matches=[ScoreCategory(**i) for i in data.get("direct_matches", [])],
            transferable=[ScoreCategory(**i) for i in data.get("transferable", [])],
            gaps=[ScoreCategory(**i) for i in data.get("gaps", [])],
            red_flags=data.get("red_flags", []),
            green_flags=data.get("green_flags", []),
            salary_estimate=salary_estimate,
        )
    except KeyError as e:
        logger.error("Claude response missing required field: %s", e)
        raise ValueError(f"Claude response missing required field: {e}") from e


def analyze_job(
    job_title: str,
    company: str,
    job_description: str,
    listed_salary: str | None = None,
    api_key: str | None = None,
    resume_text: str = "",
    instructions: str = "",
) -> AnalyzeResponse:
    logger.info("Starting analysis: %s at %s", job_title, company)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = _build_system_prompt(resume_text, instructions)
    salary_context = f"\nLISTED SALARY: {listed_salary}" if listed_salary else "\nLISTED SALARY: Not provided"

    user_message = f"""Please analyze this job posting for fit:

JOB TITLE: {job_title}
COMPANY: {company}{salary_context}

JOB DESCRIPTION:
{job_description}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
    except RateLimitError as e:
        logger.error("Claude API rate limit hit: %s", e)
        raise ValueError("Rate limit reached. Please wait a moment and try again.") from e
    except APIConnectionError as e:
        logger.error("Claude API connection error: %s", e)
        raise ValueError("Could not connect to Claude API. Check your internet connection.") from e
    except APIStatusError as e:
        logger.error("Claude API status error %s: %s", e.status_code, e.message)
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    logger.info(
        "Claude response received, stop_reason: %s, tokens used: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    return _parse_response(message.content[0].text, listed_salary)