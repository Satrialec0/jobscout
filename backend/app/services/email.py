import logging
from app.config import get_settings

logger = logging.getLogger(__name__)


def build_match_email_body(jobs: list[dict]) -> str:
    n = len(jobs)
    subject_noun = f"{n} new job" + ("s" if n != 1 else "")
    lines = [f"JobScout found {subject_noun} matching your profile:\n"]
    for job in jobs:
        lines.append(f"  {job['title']} at {job['company']}")
        lines.append(f"  {job['apply_url']}\n")
    lines.append("Open your dashboard to review and analyze them.")
    return "\n".join(lines)


def build_expiry_email_body() -> str:
    return (
        "Your hiring.cafe session has expired and JobScout has paused polling.\n\n"
        "Visit hiring.cafe in your browser to automatically refresh your session. "
        "Polling will resume within the hour."
    )


def send_email(to_email: str, subject: str, body: str) -> None:
    settings = get_settings()
    if not settings.sendgrid_api_key or not settings.sendgrid_from_email:
        logger.warning("SendGrid not configured — skipping email to %s", to_email)
        return

    try:
        import sendgrid as sg_module
        from sendgrid.helpers.mail import Mail
        client = sg_module.SendGridAPIClient(settings.sendgrid_api_key)
        message = Mail(
            from_email=settings.sendgrid_from_email,
            to_emails=to_email,
            subject=subject,
            plain_text_content=body,
        )
        response = client.send(message)
        logger.info("Email sent to %s, status %s", to_email, response.status_code)
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
