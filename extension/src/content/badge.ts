console.log("[JobScout Badge] Badge module loaded");

const BADGE_CLASS = "jobscout-badge";
const TOOLTIP_CLASS = "jobscout-tooltip";

interface StoredJobScore {
  score: number;
  shouldApply: boolean;
  verdict?: string;
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
    "cursor: default",
    "position: relative",
  ].join("; ");
}

function injectTooltipStyles(): void {
  if (document.getElementById("jobscout-tooltip-styles")) return;

  const style = document.createElement("style");
  style.id = "jobscout-tooltip-styles";
  style.textContent = `
    .${TOOLTIP_CLASS} {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 400;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.5;
      white-space: normal;
      width: 220px;
      text-align: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .${TOOLTIP_CLASS}::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #334155;
    }
    .${BADGE_CLASS}:hover .${TOOLTIP_CLASS} {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
  console.log("[JobScout Badge] Tooltip styles injected");
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
  verdict?: string,
): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  const { bg, text, border } = getScoreColor(score);
  badge.style.cssText = buildBadgeStyle(bg, text, border);
  badge.textContent = `${score}${shouldApply ? " ✓" : ""}`;
  badge.title = `JobScout: ${score}/100 — ${shouldApply ? "Apply" : "Skip"}`;

  if (verdict) {
    const tooltip = document.createElement("span");
    tooltip.className = TOOLTIP_CLASS;
    tooltip.textContent = verdict;
    badge.appendChild(tooltip);
  }

  return badge;
}

export function extractJobId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>(
    "a[href*='currentJobId'], a[href*='/jobs/view/'], a[href*='jk='], a[href*='/viewjob']",
  );
  if (!link) return null;

  const href = link.href;

  const currentJobIdMatch = href.match(/currentJobId=(\d+)/);
  if (currentJobIdMatch) return currentJobIdMatch[1];

  const viewMatch = href.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];

  const jkMatch = href.match(/[?&]jk=([a-zA-Z0-9]+)/);
  if (jkMatch) return jkMatch[1];

  const segments = href.replace(/\/$/, "").split("/");
  const last = segments[segments.length - 1];
  if (last && last.length > 3 && !last.includes("=") && !last.includes(".")) {
    return last;
  }

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
  verdict?: string,
): void {
  injectTooltipStyles();

  const cards = document.querySelectorAll(`[data-jobscout-id="${jobId}"]`);

  cards.forEach((card) => {
    const existing = card.querySelector(`.${BADGE_CLASS}`);
    if (!existing) return;
    const newBadge = createScoreBadge(score, shouldApply, verdict);
    existing.replaceWith(newBadge);
    console.log("[JobScout Badge] Updated badge for job:", jobId, "→", score);
  });
}

export function checkAndInjectFromStorage(card: Element): void {
  injectTooltipStyles();

  const jobId = extractJobId(card);
  if (!jobId) return;

  if (card.hasAttribute("data-jobscout-id")) return;

  const storageKey = `jobid_${jobId}`;
  chrome.storage.local.get(storageKey, (data) => {
    const stored = data[storageKey] as StoredJobScore | undefined;

    if (stored) {
      const target = findBadgeTarget(card);
      if (!target) return;
      const badge = createScoreBadge(
        stored.score,
        stored.shouldApply,
        stored.verdict,
      );
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
