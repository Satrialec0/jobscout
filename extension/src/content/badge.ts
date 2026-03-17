console.log("[JobScout Badge] Badge module loaded");

const BADGE_CLASS = "jobscout-badge";

interface StoredJobScore {
  score: number;
  shouldApply: boolean;
}

function getScoreColor(score: number): {
  bg: string;
  text: string;
  border: string;
} {
  if (score >= 80) return { bg: "#052e16", text: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", text: "#facc15", border: "#854d0e" };
  if (score >= 40) return { bg: "#1c0a00", text: "#fb923c", border: "#9a3412" };
  return { bg: "#2d1515", text: "#f87171", border: "#7f1d1d" };
}

function buildBadgeStyle(bg: string, text: string, border: string): string {
  return [
    `background: ${bg}`,
    `color: ${text}`,
    `border: 1px solid ${border}`,
    "border-radius: 4px",
    "padding: 2px 6px",
    "font-size: 11px",
    "font-weight: 600",
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "line-height: 1.4",
    "white-space: nowrap",
    "display: inline-block",
    "margin-left: 6px",
    "vertical-align: middle",
  ].join("; ");
}

function createPendingBadge(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.style.cssText = buildBadgeStyle("#1e293b", "#64748b", "#334155");
  badge.textContent = "···";
  badge.title = "JobScout: analyzing...";
  return badge;
}

function createScoreBadge(
  score: number,
  shouldApply: boolean,
): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  const { bg, text, border } = getScoreColor(score);
  badge.style.cssText = buildBadgeStyle(bg, text, border);
  badge.textContent = `${score}${shouldApply ? " ✓" : ""}`;
  badge.title = `JobScout: ${score}/100 — ${shouldApply ? "Apply" : "Skip"}`;
  return badge;
}

export function extractJobId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>(
    "a[href*='currentJobId'], a[href*='/jobs/view/']",
  );
  if (!link) return null;

  const href = link.href;

  const currentJobIdMatch = href.match(/currentJobId=(\d+)/);
  if (currentJobIdMatch) return currentJobIdMatch[1];

  const viewMatch = href.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];

  return null;
}

function findBadgeTarget(card: Element): Element | null {
  return (
    card.querySelector(".job-card-list__title") ||
    card.querySelector(".job-card-container__link") ||
    card.querySelector("[class*='job-card'] a") ||
    null
  );
}

export function injectPendingBadge(card: Element, jobId: string): void {
  if (card.querySelector(`.${BADGE_CLASS}`)) return;

  const target = findBadgeTarget(card);
  if (!target) return;

  const badge = createPendingBadge();
  target.appendChild(badge);
  card.setAttribute("data-jobscout-id", jobId);
  console.log("[JobScout Badge] Injected pending badge for job:", jobId);
}

export function updateBadgeForJobId(
  jobId: string,
  score: number,
  shouldApply: boolean,
): void {
  const cards = document.querySelectorAll(`[data-jobscout-id="${jobId}"]`);

  cards.forEach((card) => {
    const existing = card.querySelector(`.${BADGE_CLASS}`);
    if (!existing) return;
    const newBadge = createScoreBadge(score, shouldApply);
    existing.replaceWith(newBadge);
    console.log("[JobScout Badge] Updated badge for job:", jobId, "→", score);
  });
}

export function checkAndInjectFromStorage(card: Element): void {
  const jobId = extractJobId(card);
  if (!jobId) return;

  if (card.hasAttribute("data-jobscout-id")) return;

  const storageKey = `jobid_${jobId}`;
  chrome.storage.local.get(storageKey, (data) => {
    const stored = data[storageKey] as StoredJobScore | undefined;

    if (stored) {
      const target = findBadgeTarget(card);
      if (!target) return;
      const badge = createScoreBadge(stored.score, stored.shouldApply);
      target.appendChild(badge);
      card.setAttribute("data-jobscout-id", jobId);
      console.log(
        "[JobScout Badge] Injected cached badge for job:",
        jobId,
        "→",
        stored.score,
      );
    } else {
      injectPendingBadge(card, jobId);
    }
  });
}
