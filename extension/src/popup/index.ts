console.log("[JobScout Popup] Loaded");

interface ScoreCategory {
  item: string;
  detail: string;
}

interface AnalyzeResponse {
  fit_score: number;
  should_apply: boolean;
  one_line_verdict: string;
  direct_matches: ScoreCategory[];
  transferable: ScoreCategory[];
  gaps: ScoreCategory[];
  red_flags: string[];
  green_flags: string[];
}

interface StoredScore {
  result: AnalyzeResponse;
  jobTitle: string;
  company: string;
  timestamp: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#facc15";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}

function getScoreTrackColor(score: number): string {
  if (score >= 80) return "#052e16";
  if (score >= 60) return "#1c1917";
  if (score >= 40) return "#1c0a00";
  return "#2d1515";
}

function buildScoreRing(score: number): string {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const color = getScoreColor(score);
  const track = getScoreTrackColor(score);

  return `
    <div class="score-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="${radius}" fill="none" stroke="${track}" stroke-width="6"/>
        <circle cx="36" cy="36" r="${radius}" fill="none"
          stroke="${color}" stroke-width="6"
          stroke-dasharray="${filled} ${circumference}"
          stroke-linecap="round"/>
      </svg>
      <div class="score-number" style="color: ${color}">${score}</div>
    </div>
  `;
}

function buildSection(
  title: string,
  dotColor: string,
  count: number,
  bodyHtml: string,
  defaultOpen = false,
): string {
  const openClass = defaultOpen ? "open" : "";
  return `
    <div class="section">
      <div class="section-header" onclick="toggleSection(this)">
        <span class="section-title">
          <span class="section-dot" style="background: ${dotColor}"></span>
          ${title}
          <span class="section-count">${count}</span>
        </span>
        <span class="section-chevron ${openClass}">▼</span>
      </div>
      <div class="section-body ${openClass}">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderScore(stored: StoredScore): void {
  const { result, jobTitle, company, timestamp } = stored;

  const timestampEl = document.getElementById("timestamp");
  if (timestampEl) {
    const mins = Math.round((Date.now() - timestamp) / 60000);
    timestampEl.textContent = mins < 1 ? "just now" : `${mins}m ago`;
  }

  const directMatchesHtml = result.direct_matches
    .map(
      (i) => `
    <div class="section-item">
      <div class="item-label">${i.item}</div>
      <div class="item-detail">${i.detail}</div>
    </div>
  `,
    )
    .join("");

  const transferableHtml = result.transferable
    .map(
      (i) => `
    <div class="section-item">
      <div class="item-label">${i.item}</div>
      <div class="item-detail">${i.detail}</div>
    </div>
  `,
    )
    .join("");

  const gapsHtml = result.gaps
    .map(
      (i) => `
    <div class="section-item">
      <div class="item-label">${i.item}</div>
      <div class="item-detail">${i.detail}</div>
    </div>
  `,
    )
    .join("");

  const greenFlagsHtml = result.green_flags
    .map(
      (f) => `
    <div class="flag-item" style="color: #4ade80">
      <span class="flag-dot"></span>${f}
    </div>
  `,
    )
    .join("");

  const redFlagsHtml = result.red_flags
    .map(
      (f) => `
    <div class="flag-item" style="color: #f87171">
      <span class="flag-dot"></span>${f}
    </div>
  `,
    )
    .join("");

  const applyClass = result.should_apply ? "yes" : "no";
  const applyText = result.should_apply ? "✓ Apply" : "✗ Skip";

  const html = `
    <div class="score-hero">
      ${buildScoreRing(result.fit_score)}
      <div class="score-meta">
        <div class="score-job-title">${jobTitle}</div>
        <div class="score-company">${company}</div>
        <span class="apply-badge ${applyClass}">${applyText}</span>
      </div>
    </div>
    <div class="verdict">${result.one_line_verdict}</div>
    ${buildSection("Direct matches", "#4ade80", result.direct_matches.length, directMatchesHtml, true)}
    ${buildSection("Transferable", "#facc15", result.transferable.length, transferableHtml)}
    ${buildSection("Gaps", "#f87171", result.gaps.length, gapsHtml)}
    ${buildSection("Flags", "#94a3b8", result.green_flags.length + result.red_flags.length, greenFlagsHtml + redFlagsHtml)}
    <div class="footer">Powered by Claude · JobScout v0.1.0</div>
  `;

  const content = document.getElementById("content");
  if (content) content.innerHTML = html;
}

function renderEmpty(): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `
      <div class="state-empty">
        <div style="font-size: 28px; margin-bottom: 12px">🔍</div>
        Navigate to a job listing on LinkedIn, Indeed, or Hiring.cafe to see your fit score.
      </div>
    `;
  }
}

function renderError(message: string): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `
      <div class="state-error">
        <div style="font-size: 28px; margin-bottom: 12px">⚠️</div>
        ${message}
      </div>
    `;
  }
}

(
  window as Window &
    typeof globalThis & { toggleSection: (el: HTMLElement) => void }
).toggleSection = (header: HTMLElement) => {
  const chevron = header.querySelector(".section-chevron");
  const body = header.nextElementSibling;
  if (chevron) chevron.classList.toggle("open");
  if (body) body.classList.toggle("open");
};

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url) {
    renderEmpty();
    return;
  }

  const supportedSites = [
    "linkedin.com/jobs",
    "indeed.com/viewjob",
    "hiring.cafe",
  ];
  const isSupported = supportedSites.some((site) => tab.url!.includes(site));

  if (!isSupported) {
    renderEmpty();
    return;
  }

  chrome.runtime.sendMessage(
    { type: "GET_SCORE", url: tab.url },
    (response) => {
      if (chrome.runtime.lastError) {
        renderError("Could not connect to JobScout background worker.");
        return;
      }

      if (!response?.success) {
        renderEmpty();
        return;
      }

      renderScore(response.data);
    },
  );
});
