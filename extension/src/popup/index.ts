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
  salary?: string;
  easyApply?: boolean;
  jobAge?: string;
}

interface BackendScoreResponse {
  fit_score: number;
  should_apply: boolean;
  one_line_verdict: string;
  direct_matches: ScoreCategory[];
  transferable: ScoreCategory[];
  gaps: ScoreCategory[];
  red_flags: string[];
  green_flags: string[];
  job_title: string;
  company: string;
  created_at: string;
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

function renderLoading(): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `
      <div class="state-loading">
        <div class="spinner"></div>
        <div class="loading-label">Analyzing job...</div>
        <div class="loading-sub">This takes about 10 seconds</div>
      </div>
    `;
  }
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

function renderScore(
  stored: StoredScore,
  tabUrl: string,
  isApplied: boolean,
): void {
  const { result, jobTitle, company, timestamp, salary, easyApply, jobAge } =
    stored;

  const timestampEl = document.getElementById("timestamp");
  if (timestampEl) {
    const mins = Math.round((Date.now() - timestamp) / 60000);
    timestampEl.textContent = mins < 1 ? "just now" : `${mins}m ago`;
  }

  const jobIdMatch = tabUrl.match(/currentJobId=(\d+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : "";

  const applyClass = result.should_apply ? "yes" : "no";
  const applyText = result.should_apply ? "✓ Apply" : "✗ Skip";
  const isStale = jobAge
    ? jobAge.includes("month") ||
      (jobAge.includes("week") && parseInt(jobAge) >= 4) ||
      (jobAge.includes("day") && parseInt(jobAge) >= 30)
    : false;

  const metaBadges = [
    `<span class="apply-badge ${applyClass}">${applyText}</span>`,
    isApplied ? `<span class="applied-badge">✓ Applied</span>` : "",
    salary ? `<span class="salary-badge">$ ${salary}</span>` : "",
    easyApply ? `<span class="easy-apply-badge">⚡ Easy Apply</span>` : "",
    jobAge
      ? `<span class="age-badge${isStale ? " stale" : ""}">🕐 ${jobAge}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

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

  const html = `
    <div class="score-hero">
      ${buildScoreRing(result.fit_score)}
      <div class="score-meta">
        <div class="score-job-title">${jobTitle}</div>
        <div class="score-company">${company}</div>
        <div class="badge-row">${metaBadges}</div>
      </div>
    </div>
    <div class="verdict">${result.one_line_verdict}</div>
    <div class="action-bar">
      <button class="btn btn-reanalyze" id="btn-reanalyze" data-job-id="${jobId}" data-url="${tabUrl}">
        ↺ Re-analyze
      </button>
      <button class="btn btn-applied ${isApplied ? "done" : ""}" id="btn-applied" data-job-id="${jobId}">
        ${isApplied ? "✓ Applied" : "Mark Applied"}
      </button>
    </div>
    ${buildSection("Direct matches", "#4ade80", result.direct_matches.length, directMatchesHtml, true)}
    ${buildSection("Transferable", "#facc15", result.transferable.length, transferableHtml)}
    ${buildSection("Gaps", "#f87171", result.gaps.length, gapsHtml)}
    ${buildSection("Flags", "#94a3b8", result.green_flags.length + result.red_flags.length, greenFlagsHtml + redFlagsHtml)}
    <div class="footer">Powered by Claude · JobScout v0.1.0</div>
  `;

  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = html;
    attachActionListeners(tabUrl);
  }
}

function attachActionListeners(tabUrl: string): void {
  const reanalyzeBtn = document.getElementById("btn-reanalyze");
  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener("click", () => {
      reanalyzeBtn.textContent = "Analyzing...";
      (reanalyzeBtn as HTMLButtonElement).disabled = true;
      renderLoading();

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;

        chrome.tabs.sendMessage(tab.id, {
          type: "TRIGGER_REANALYZE",
          url: tabUrl,
        });

        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          chrome.storage.local.get(`score_${tabUrl}`, (data) => {
            const stored = data[`score_${tabUrl}`] as StoredScore | undefined;
            if (stored && stored.timestamp > Date.now() - 30000) {
              clearInterval(poll);
              const jobId = tabUrl.match(/currentJobId=(\d+)/)?.[1] ?? "";
              chrome.storage.local.get(`applied_${jobId}`, (appliedData) => {
                const isApplied = !!appliedData[`applied_${jobId}`];
                renderScore(stored, tabUrl, isApplied);
              });
            }
          });
          if (attempts > 30) clearInterval(poll);
        }, 1000);
      });
    });
  }

  const appliedBtn = document.getElementById("btn-applied");
  if (appliedBtn && !appliedBtn.classList.contains("done")) {
    appliedBtn.addEventListener("click", () => {
      const jobId = appliedBtn.getAttribute("data-job-id") ?? "";
      if (!jobId) return;

      chrome.runtime.sendMessage(
        { type: "MARK_APPLIED", jobId },
        (response) => {
          if (response?.success) {
            appliedBtn.textContent = "✓ Applied";
            appliedBtn.classList.add("done");
            (appliedBtn as HTMLButtonElement).disabled = true;
            console.log("[JobScout Popup] Marked as applied:", jobId);
          }
        },
      );
    });
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

  const jobIdMatch = tab.url.match(/currentJobId=(\d+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : null;

  chrome.storage.local.get(`score_${tab.url}`, (data) => {
    const stored = data[`score_${tab.url}`] as StoredScore | undefined;

    if (stored) {
      const appliedKey = jobId ? `applied_${jobId}` : "";
      chrome.storage.local.get(appliedKey, (appliedData) => {
        const isApplied = !!appliedData[appliedKey];
        renderScore(stored, tab.url!, isApplied);
      });
      return;
    }

    if (jobId) {
      chrome.runtime.sendMessage(
        { type: "GET_SCORE_FROM_BACKEND", jobId },
        (response) => {
          if (response?.success) {
            const backendData = response.data as BackendScoreResponse;
            const reconstructed: StoredScore = {
              result: {
                fit_score: backendData.fit_score,
                should_apply: backendData.should_apply,
                one_line_verdict: backendData.one_line_verdict,
                direct_matches: backendData.direct_matches,
                transferable: backendData.transferable,
                gaps: backendData.gaps,
                red_flags: backendData.red_flags,
                green_flags: backendData.green_flags,
              },
              jobTitle: backendData.job_title,
              company: backendData.company,
              timestamp: new Date(backendData.created_at).getTime(),
            };

            chrome.storage.local.set({ [`score_${tab.url}`]: reconstructed });
            renderScore(reconstructed, tab.url!, false);
          } else {
            renderLoading();
          }
        },
      );
    } else {
      renderLoading();
    }
  });
});
