import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.config import get_settings
from app.schemas.app_assist import AppQuestionRequest, AppQuestionResponse

logger = logging.getLogger(__name__)

_BASE_PROMPT = """You are helping a specific candidate craft a concise, compelling answer to a job application question.

INSTRUCTIONS:
- Answer the application question directly and specifically, grounded in the candidate's actual experience.
- Be concise — 2-4 sentences for simple questions, up to 2 short paragraphs for complex ones.
- Use specific examples from their background where possible.
- Avoid generic filler phrases. Be direct and confident.
- Plain prose only — no bullet points, no markdown.
- Do not repeat the question in the answer."""


def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""


def generate_app_answer(
    request: AppQuestionRequest,
    api_key: str | None = None,
    resume_text: str = "",
    instructions: str = "",
) -> AppQuestionResponse:
    logger.info("Generating application answer for: %s at %s", request.job_title, request.company)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = _build_system_prompt(resume_text, instructions)
    jd_section = f"\nJOB DESCRIPTION:\n{request.job_description}" if request.job_description.strip() else ""

    user_message = f"""Answer this job application question for the candidate.

JOB TITLE: {request.job_title}
COMPANY: {request.company}
{jd_section}

ANALYSIS RESULTS:
Direct Matches: {request.direct_matches}
Transferable Skills: {request.transferable}
Gaps: {request.gaps}

APPLICATION QUESTION:
{request.question}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
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
        "App answer response received, stop_reason: %s, tokens: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    return AppQuestionResponse(answer=message.content[0].text.strip())
