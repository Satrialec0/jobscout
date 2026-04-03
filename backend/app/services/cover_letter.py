import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.config import get_settings
from app.schemas.app_assist import CoverLetterRequest, CoverLetterResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert cover letter writer crafting a targeted, professional cover letter on behalf of a specific candidate.

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

INSTRUCTIONS:
- Write the cover letter as plain text, ready to paste into an application — no markdown, no headers, no subject line.
- Start directly with "Dear Hiring Team," unless a specific salutation is appropriate.
- Structure: brief opening hook → 1-2 paragraphs connecting Christopher's specific experience to this role's needs → closing with clear interest and call to action.
- Draw on the analysis results (direct matches, transferable skills, gaps) to make the letter targeted, not generic.
- Lean into accomplishments and specificity — avoid hollow phrases like "passionate about" or "strong communication skills."
- Do not use bullet points. Prose only.
- Tone: confident, direct, professional but not stiff. Matches a senior individual contributor applying to growth-oriented tech or energy companies.
- Do NOT include a date, address block, or signature line — just the letter body starting from the salutation.
- Do NOT include a closing salutation like "Sincerely" or "Best regards" — end after the final sentence of the letter body."""

LENGTH_INSTRUCTIONS = {
    "short": "approximately 250 words — punchy and direct, one or two short body paragraphs",
    "medium": "approximately 400 words — two solid body paragraphs with enough detail to demonstrate fit",
    "long": "approximately 600 words — three substantial paragraphs with specific examples and measurable outcomes",
}


def generate_cover_letter(request: CoverLetterRequest, api_key: str | None = None) -> CoverLetterResponse:
    logger.info("Generating cover letter for: %s at %s (length: %s)", request.job_title, request.company, request.length)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    word_count_instruction = LENGTH_INSTRUCTIONS[request.length]
    jd_section = f"\nJOB DESCRIPTION:\n{request.job_description}" if request.job_description.strip() else "\nJOB DESCRIPTION: Not available — use the analysis results below."

    user_message = f"""Write a cover letter for this job application.

Length target: {word_count_instruction}

JOB TITLE: {request.job_title}
COMPANY: {request.company}
{jd_section}

ANALYSIS RESULTS:
Direct Matches: {request.direct_matches}
Transferable Skills: {request.transferable}
Gaps: {request.gaps}
Green Flags: {request.green_flags}
Red Flags: {request.red_flags}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            system=SYSTEM_PROMPT,
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
        "Cover letter response received, stop_reason: %s, tokens: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    return CoverLetterResponse(cover_letter=message.content[0].text.strip())
