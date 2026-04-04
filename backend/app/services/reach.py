import json
import re
import logging
import anthropic
from anthropic import APIConnectionError, APIStatusError, RateLimitError
from app.schemas.reach import (
    ReachJobInput,
    ClusterResult,
    ClusterResponse,
    ReachAnalyzeResponse,
    SkillTheme,
    ExperienceGap,
    ActionableStep,
)

logger = logging.getLogger(__name__)

CANDIDATE_CONTEXT = """The candidate is Christopher, a Project Design Engineer at Hanwha Qcells USA Corp
with a background in electrical systems design, solar/BESS project development, Python/data engineering,
and cross-functional project coordination. He is targeting adjacent roles such as Solutions Engineer,
Technical Project Manager, Product Manager, or clean energy/energy tech roles."""


def _strip_markdown(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    return cleaned.strip()


def cluster_reach_jobs(jobs: list[ReachJobInput], api_key: str) -> ClusterResponse:
    """Use Claude to suggest group assignments for a list of reach jobs."""
    logger.info("Clustering %d reach jobs", len(jobs))

    job_list = "\n".join(
        f"- job_id: {j.job_id} | title: {j.title} | company: {j.company}"
        + (f" | skills: {', '.join(j.skills)}" if j.skills else "")
        for j in jobs
    )

    prompt = f"""{CANDIDATE_CONTEXT}

The candidate has marked the following jobs as "reach" roles — positions slightly above their current level that they aspire to grow into.

Jobs to cluster:
{job_list}

Group these jobs into 2-5 meaningful clusters based on role type, required skills, and career trajectory.
Each cluster should represent a distinct career path or role category.

Return ONLY a valid JSON array with no markdown, no code blocks, no explanation:
[
  {{"job_id": "<job_id>", "group_name": "<descriptive group name>", "group_id": "<snake_case_id>"}},
  ...
]

Rules:
- group_name should be concise and descriptive (e.g. "Product Management", "Solutions Engineering", "Data & Analytics")
- group_id must be snake_case with no spaces (e.g. "product_management")
- Every job_id in the input must appear exactly once in the output
- Minimize the number of groups — prefer fewer, broader groups over many narrow ones"""

    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )
    except RateLimitError as e:
        raise ValueError("Rate limit reached. Please wait and try again.") from e
    except APIConnectionError as e:
        raise ValueError("Could not connect to Claude API.") from e
    except APIStatusError as e:
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    raw = _strip_markdown(message.content[0].text)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse cluster response: %s", e)
        raise ValueError(f"Claude returned invalid JSON: {e}") from e

    groups = [ClusterResult(**item) for item in data]
    logger.info("Clustered %d jobs into %d groups", len(jobs), len({g.group_id for g in groups}))
    return ClusterResponse(groups=groups)


def analyze_reach_group(
    group_name: str, jobs: list[ReachJobInput], api_key: str
) -> ReachAnalyzeResponse:
    """Use Claude to produce structured gap analysis for a group of reach jobs."""
    logger.info("Analyzing reach group '%s' with %d jobs", group_name, len(jobs))

    job_details = []
    for j in jobs:
        detail = f"Title: {j.title} at {j.company}"
        if j.skills:
            detail += f"\nSkills listed: {', '.join(j.skills)}"
        if j.verdict:
            detail += f"\nFit verdict: {j.verdict}"
        if j.gaps:
            gap_items = [g.get("item", "") for g in j.gaps if g.get("item")]
            if gap_items:
                detail += f"\nIdentified gaps: {', '.join(gap_items)}"
        if j.description:
            detail += f"\nDescription excerpt: {j.description[:400]}"
        job_details.append(detail)

    jobs_text = "\n\n".join(f"Job {i+1}:\n{d}" for i, d in enumerate(job_details))

    prompt = f"""{CANDIDATE_CONTEXT}

The candidate has marked the following "{group_name}" roles as aspirational "reach" jobs — positions above their current level that they want to grow toward.

{jobs_text}

Analyze what the candidate needs to develop to be competitive for these roles.

Return ONLY a valid JSON object with no markdown, no code blocks, no explanation:
{{
  "skill_themes": [
    {{"skill": "<skill name>", "frequency": <number of jobs requiring it>, "detail": "<why this skill matters for these roles and how to develop it>"}}
  ],
  "experience_gaps": [
    {{"gap": "<experience type>", "detail": "<what these roles expect vs what the candidate has, and how to bridge it>"}}
  ],
  "actionable_steps": [
    {{"step": "<specific action>", "detail": "<how this step directly maps to getting these roles>"}}
  ],
  "summary": "<2-3 sentence honest assessment of the gap and the clearest path forward>"
}}

Rules:
- skill_themes: 3-6 items, ranked by frequency across the job set
- experience_gaps: 2-4 items, focused on the most material gaps
- actionable_steps: 3-5 concrete, specific actions (not generic advice)
- Be honest about gaps — do not sugarcoat"""

    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
    except RateLimitError as e:
        raise ValueError("Rate limit reached. Please wait and try again.") from e
    except APIConnectionError as e:
        raise ValueError("Could not connect to Claude API.") from e
    except APIStatusError as e:
        raise ValueError(f"Claude API error {e.status_code}: {e.message}") from e

    raw = _strip_markdown(message.content[0].text)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse reach analysis response: %s", e)
        raise ValueError(f"Claude returned invalid JSON: {e}") from e

    return ReachAnalyzeResponse(
        group_name=group_name,
        skill_themes=[SkillTheme(**s) for s in data.get("skill_themes", [])],
        experience_gaps=[ExperienceGap(**g) for g in data.get("experience_gaps", [])],
        actionable_steps=[ActionableStep(**a) for a in data.get("actionable_steps", [])],
        summary=data.get("summary", ""),
    )
