import json
import re
import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.config import get_settings
from app.schemas.company_info import CompanyInfoRequest, CompanyInfoResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a company research assistant. Return information about a company in JSON format.

Use your training knowledge first. Only use the web_search tool if you do not have confident knowledge of the company (e.g. it is a small, obscure, or very recently founded company not well represented in your training data).

Return ONLY a valid JSON object with no markdown, no code blocks, no explanation:
{
  "employees": "<headcount range or approximate size, e.g. '51–200', '1,000–5,000', '~50'> or null",
  "website": "<company website URL> or null",
  "headquarters": "<city, state or city, country> or null",
  "industry": "<industry or sector, e.g. 'Renewable Energy', 'SaaS', 'FinTech'> or null"
}

Rules:
- Prefer training knowledge for well-known companies (Fortune 500, major tech firms, established brands).
- Use web search only for companies you cannot confidently identify from training data.
- Also incorporate any details explicitly stated in the job description text.
- Do not hallucinate values. If a field is genuinely unknown after all sources, return null.
- For website: prefer the official domain (e.g. "https://acme.com"). Do not make up URLs.
- For employees: use ranges like "51–200", "1,000–5,000", or approximate like "~500".
- For industry: use the most specific label that fits."""

WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
}


def extract_company_info(request: CompanyInfoRequest) -> CompanyInfoResponse:
    logger.info("Extracting company info for: %s", request.company)

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    jd_section = request.job_description.strip() or "No job description provided."

    user_message = f"""Look up company details for "{request.company}".

Job description context (use any details stated here):
{jd_section}

Return only the JSON object described in your instructions."""

    messages = [{"role": "user", "content": user_message}]

    try:
        # Tool-use loop: keep calling until stop_reason is "end_turn"
        while True:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=[WEB_SEARCH_TOOL],
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason == "tool_use":
                # Append assistant turn, then append tool results
                messages.append({"role": "assistant", "content": response.content})

                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        logger.info(
                            "Web search triggered for company: %s, query: %s",
                            request.company,
                            getattr(block.input, "query", block.input),
                        )
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": [],  # Anthropic built-in tool — result injected by API
                        })

                messages.append({"role": "user", "content": tool_results})
            else:
                # Unexpected stop reason — break and attempt to parse whatever we have
                logger.warning("Unexpected stop_reason: %s", response.stop_reason)
                break

    except RateLimitError as e:
        logger.error("Claude API rate limit hit: %s", e)
        raise ValueError("Rate limit reached. Please wait a moment and try again.") from e
    except APIConnectionError as e:
        logger.error("Claude API connection error: %s", e)
        raise ValueError("Could not connect to Claude API.") from e
    except APIStatusError as e:
        logger.error("Claude API status error %s: %s", e.status_code, e.message)
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    # Extract text from the final response
    raw = ""
    for block in response.content:
        if hasattr(block, "text"):
            raw = block.text.strip()
            break

    if not raw:
        logger.error("No text content in final response for company: %s", request.company)
        raise ValueError("Claude returned no text content")

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    raw = raw.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse company info response as JSON: %s — raw: %s", e, raw[:200])
        raise ValueError(f"Claude returned invalid JSON: {e}") from e

    return CompanyInfoResponse(
        employees=data.get("employees") or None,
        website=data.get("website") or None,
        headquarters=data.get("headquarters") or None,
        industry=data.get("industry") or None,
    )
