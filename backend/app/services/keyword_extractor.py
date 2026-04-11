import json
import logging
from typing import Optional
import anthropic
from app.config import get_settings

logger = logging.getLogger(__name__)

_EXTRACTION_PROMPT = """Extract technical skills, tools, technologies, programming languages, frameworks, domain keywords, and relevant professional skills from this resume text.

Return ONLY a JSON array of strings. No explanation, no markdown, no code blocks. Example:
["Python", "FastAPI", "PostgreSQL", "machine learning", "REST APIs"]

Resume text:
{resume_text}"""


def extract_keywords_from_resume(resume_text: Optional[str]) -> list[str]:
    """Call Claude to extract skills/keywords from resume_text.
    Returns empty list if resume_text is None or blank.
    """
    if not resume_text or not resume_text.strip():
        return []

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": _EXTRACTION_PROMPT.format(resume_text=resume_text.strip()),
                }
            ],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code blocks if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        keywords = json.loads(raw.strip())
        if not isinstance(keywords, list):
            return []
        return [str(k).strip() for k in keywords if str(k).strip()]
    except Exception as e:
        logger.error("Keyword extraction failed: %s", e)
        return []
