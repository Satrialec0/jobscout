import json
import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.config import get_settings
from app.schemas.interview_prep import InterviewPrepRequest, InterviewPrepResponse, GapStrategy, QuestionWithTalkingPoint

logger = logging.getLogger(__name__)

_BASE_PROMPT = """You are an expert interview coach preparing a specific candidate for a job interview.

You will receive a job posting analysis including direct skill matches, transferable skills, gaps, and flags. Use this to generate targeted, specific interview preparation content.

Return ONLY a valid JSON object with no markdown, no code blocks, no explanation. The JSON must exactly match this schema:
{
  "questions": [
    {
      "question": "<specific behavioral or technical question the interviewer is likely to ask>",
      "talking_points": [
        "<concise bullet guiding one aspect of the answer — a memory trigger, specific example, or angle to hit>",
        "<another bullet>"
      ]
    }
  ],
  "research_prompts": [
    "<specific thing to research about the company, role, or industry before the interview>"
  ],
  "gap_strategies": [
    {
      "gap": "<the gap or missing requirement from the analysis>",
      "strategy": "<concrete, honest way to address this gap if asked>"
    }
  ],
  "questions_to_ask": [
    "<smart, specific question to ask the interviewer that demonstrates genuine curiosity and role understanding>"
  ]
}

INSTRUCTIONS:
- questions: 6-8 entries. Each entry pairs one likely interview question with 2-4 talking_points — short bullet fragments that guide the response, not a scripted answer. Each bullet should be a memory trigger: a specific project, metric, tool, or angle to hit. Think of them as the notes you'd jot on an index card before walking in, not sentences to recite.
- research_prompts: 4-5 prompts. Be specific about what to look for (e.g. "Look into their recent funding round and what products/markets they're expanding into").
- gap_strategies: One entry per significant gap from the analysis. Be honest but constructive — acknowledge the gap and pivot to adjacent experience.
- questions_to_ask: 4-6 questions to ask the interviewer. Tailor to the specific role and company — avoid generic questions. Cover things like team dynamics, technical stack decisions, success metrics for the role, and growth/roadmap areas."""


def _build_system_prompt(resume_text: str, instructions: str) -> str:
    resume_section = resume_text.strip() if resume_text and resume_text.strip() else "No resume provided."
    return f"""{_BASE_PROMPT}

CANDIDATE RESUME:
{resume_section}

ANALYSIS INSTRUCTIONS:
{instructions}"""


def generate_prep_brief(
    request: InterviewPrepRequest,
    api_key: str | None = None,
    resume_text: str = "",
    instructions: str = "",
) -> InterviewPrepResponse:
    logger.info("Generating interview prep brief for: %s at %s", request.job_title, request.company)

    if not api_key:
        settings = get_settings()
        api_key = settings.anthropic_api_key
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = _build_system_prompt(resume_text, instructions)
    jd_section = f"\nJOB DESCRIPTION:\n{request.job_description}" if request.job_description.strip() else "\nJOB DESCRIPTION: Not available — use the analysis results below."

    user_message = f"""Generate an interview prep brief for this job:

JOB TITLE: {request.job_title}
COMPANY: {request.company}
{jd_section}

ANALYSIS RESULTS:
Direct Matches: {json.dumps(request.direct_matches)}
Transferable Skills: {json.dumps(request.transferable)}
Gaps: {json.dumps(request.gaps)}
Green Flags: {json.dumps(request.green_flags)}
Red Flags: {json.dumps(request.red_flags)}"""

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
        "Interview prep response received, stop_reason: %s, tokens: %s",
        message.stop_reason,
        message.usage.input_tokens + message.usage.output_tokens
    )

    raw = message.content[0].text
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        import re
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Claude prep response as JSON: %s", e)
        raise ValueError(f"Claude returned invalid JSON: {e}") from e

    try:
        return InterviewPrepResponse(
            questions=[QuestionWithTalkingPoint(**q) for q in data.get("questions", [])],
            research_prompts=data.get("research_prompts", []),
            gap_strategies=[GapStrategy(**g) for g in data.get("gap_strategies", [])],
            questions_to_ask=data.get("questions_to_ask", []),
        )
    except (KeyError, TypeError) as e:
        logger.error("Failed to parse prep response fields: %s", e)
        raise ValueError(f"Invalid prep response structure: {e}") from e
