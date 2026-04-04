console.log("[JobScout Popup] Loaded");

interface ScoreCategory {
  item: string;
  detail: string;
}

interface SalaryEstimate {
  low: number;
  high: number;
  currency: string;
  per: string;
  confidence: string;
  assessment: string | null;
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
  salary_estimate?: SalaryEstimate;
}

interface StoredScore {
  result: AnalyzeResponse;
  jobTitle: string;
  company: string;
  timestamp: number;
  salary?: string;
  easyApply?: boolean;
  jobAge?: string;
  jobAgeIsOld?: boolean;
  dbId?: number;
}

interface ReachJob {
  jobId: string;
  title: string;
  company: string;
  url: string;
  site: string;
  groupId?: string;
  timestamp: number;
}

function detectSiteFromUrl(url: string): string {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("indeed.com")) return "indeed";
  if (url.includes("hiring.cafe")) return "hiring-cafe";
  return "unknown";
}

function buildReachButtonHtml(isReach: boolean): string {
  return isReach
    ? `<button class="btn btn-reach active" id="btn-reach" title="Remove reach tag">⭐ Reach</button>`
    : `<button class="btn btn-reach" id="btn-reach" title="Mark as a reach role">☆ Reach</button>`;
}

function wireReachButton(jobId: string, tabUrl: string, jobTitle: string, company: string): void {
  const btn = document.getElementById("btn-reach") as HTMLButtonElement | null;
  if (!btn) return;

  btn.addEventListener("click", () => {
    const reachKey = `reach_jobid_${jobId}`;
    chrome.storage.local.get(reachKey, (data) => {
      const existing = data[reachKey] as ReachJob | undefined;
      if (existing) {
        chrome.storage.local.remove(reachKey);
        btn.textContent = "☆ Reach";
        btn.classList.remove("active");
        btn.title = "Mark as a reach role";
      } else {
        const site = detectSiteFromUrl(tabUrl);
        const reachJob: ReachJob = {
          jobId,
          title: jobTitle,
          company,
          url: tabUrl,
          site,
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ [reachKey]: reachJob });
        btn.textContent = "⭐ Reach";
        btn.classList.add("active");
        btn.title = "Remove reach tag";
      }
    });
  });
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

function getConfidenceColor(confidence: string): string {
  if (confidence === "high") return "#a78bfa";
  if (confidence === "medium") return "#818cf8";
  return "#6b7280";
}

function formatSalaryEstimate(est: SalaryEstimate): string {
  const low = `$${(est.low / 1000).toFixed(0)}k`;
  const high = `$${(est.high / 1000).toFixed(0)}k`;
  return `${low}–${high}/yr`;
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
      <div class="section-header">
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

function renderNotSignedIn(): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `
      <div class="state-empty" style="padding: 28px 16px">
        <div style="font-size: 32px; margin-bottom: 14px">🔐</div>
        <div style="font-weight: 600; margin-bottom: 8px">Sign in to JobScout</div>
        <div style="font-size: 12px; color: #8892a4; margin-bottom: 20px; line-height: 1.5">
          Create a free account to start analyzing job listings with your own Anthropic API key.
        </div>
        <button class="btn" id="btn-open-login" style="background:#e94560;color:#fff;border:none;border-radius:6px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;width:100%">
          Sign In / Register
        </button>
      </div>
    `;
    document.getElementById("btn-open-login")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
    });
  }
}

function renderNoApiKey(): void {
  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = `
      <div class="state-empty" style="padding: 28px 16px">
        <div style="font-size: 32px; margin-bottom: 14px">🔑</div>
        <div style="font-weight: 600; margin-bottom: 8px">API Key Required</div>
        <div style="font-size: 12px; color: #8892a4; margin-bottom: 20px; line-height: 1.5">
          Add your Anthropic API key to enable job analysis.
        </div>
        <button class="btn" id="btn-open-login" style="background:#e94560;color:#fff;border:none;border-radius:6px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;width:100%">
          Add API Key
        </button>
      </div>
    `;
    document.getElementById("btn-open-login")?.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
    });
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

function buildBulkBarHtml(tabUrl: string): string {
  const isSupported =
    tabUrl.includes("hiring.cafe") ||
    (tabUrl.includes("linkedin.com/jobs") &&
      (tabUrl.includes("currentJobId=") || tabUrl.includes("/jobs/view/"))) ||
    (tabUrl.includes("indeed.com") &&
      (tabUrl.includes("vjk=") ||
        tabUrl.includes("jk=") ||
        tabUrl.includes("/viewjob")));
  if (!isSupported) return "";
  return `
    <div class="bulk-bar">
      <button class="btn btn-bulk" id="btn-bulk-score">
        ⚡ Enable Bulk Queue
      </button>
      <div class="bulk-progress" id="bulk-progress" style="display:none">
        <span id="bulk-status">Ready — open cards to queue them</span>
        <button class="btn btn-cancel-bulk" id="btn-cancel-bulk">✕ Clear</button>
      </div>
    </div>
  `;
}

function renderScore(
  stored: StoredScore,
  tabUrl: string,
  isApplied: boolean,
  jobId: string,
  isReach = false,
): void {
  const { result, jobTitle, company, timestamp, salary, easyApply, jobAge } =
    stored;

  const timestampEl = document.getElementById("timestamp");
  if (timestampEl) {
    const mins = Math.round((Date.now() - timestamp) / 60000);
    timestampEl.textContent = mins < 1 ? "just now" : `${mins}m ago`;
  }

  const applyClass = result.should_apply ? "yes" : "no";
  const applyText = result.should_apply ? "✓ Apply" : "✗ Skip";

  const salaryEstimate = result.salary_estimate;

  let salaryBadgeHtml = "";
  if (salary) {
    salaryBadgeHtml = `<span class="salary-badge">$ ${salary}</span>`;
  } else if (salaryEstimate) {
    const confColor = getConfidenceColor(salaryEstimate.confidence);
    salaryBadgeHtml = `<span class="salary-badge" style="border-color: ${confColor}; color: ${confColor}; opacity: 0.85;" title="Market estimate — ${salaryEstimate.confidence} confidence">~ ${formatSalaryEstimate(salaryEstimate)}</span>`;
  }

  const assessmentHtml = salaryEstimate?.assessment
    ? `<div style="font-size: 11px; color: #a78bfa; padding: 8px 16px; border-bottom: 1px solid #1e293b; font-style: italic; line-height: 1.5;">💰 ${salaryEstimate.assessment}</div>`
    : "";

  const metaBadges = [
    `<span class="apply-badge ${applyClass}">${applyText}</span>`,
    isApplied ? `<span class="applied-badge">✓ Applied</span>` : "",
    salaryBadgeHtml,
    easyApply ? `<span class="easy-apply-badge">⚡ Easy Apply</span>` : "",
    jobAge ? `<span class="age-badge">🕐 ${jobAge}</span>` : "",
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
    ${assessmentHtml}
    <div class="action-bar">
      <button class="btn btn-reanalyze" id="btn-reanalyze" data-job-id="${jobId}" data-url="${tabUrl}">
        ↺ Re-analyze
      </button>
      <button class="btn btn-applied ${isApplied ? "done" : ""}" id="btn-applied" data-job-id="${jobId}">
        ${isApplied ? "✓ Applied" : "Mark Applied"}
      </button>
      ${buildReachButtonHtml(isReach)}
    </div>
    ${buildBulkBarHtml(tabUrl)}
    ${buildSection("Direct matches", "#4ade80", result.direct_matches.length, directMatchesHtml, true)}
    ${buildSection("Transferable", "#facc15", result.transferable.length, transferableHtml)}
    ${buildSection("Gaps", "#f87171", result.gaps.length, gapsHtml)}
    ${buildSection("Flags", "#94a3b8", result.green_flags.length + result.red_flags.length, greenFlagsHtml + redFlagsHtml)}
    <div class="footer">Powered by Claude · JobScout v0.1.0</div>
  `;

  const content = document.getElementById("content");
  if (content) {
    content.innerHTML = html;
    attachActionListeners(tabUrl, jobId, jobTitle, company);

    // Wire section toggles — inline onclick blocked by CSP in MV3
    content.querySelectorAll(".section-header").forEach((header) => {
      header.addEventListener("click", () => {
        const chevron = header.querySelector(".section-chevron");
        const body = header.nextElementSibling;
        if (chevron) chevron.classList.toggle("open");
        if (body) body.classList.toggle("open");
      });
    });
  }
}

function showScore(stored: StoredScore, tabUrl: string, isApplied: boolean, jobId: string): void {
  chrome.storage.local.get(`reach_jobid_${jobId}`, (data) => {
    const isReach = !!data[`reach_jobid_${jobId}`];
    renderScore(stored, tabUrl, isApplied, jobId, isReach);
  });
}

function attachBulkListeners(tabId: number): void {
  const bulkBtn = document.getElementById(
    "btn-bulk-score",
  ) as HTMLButtonElement | null;
  const progressEl = document.getElementById("bulk-progress");
  const statusEl = document.getElementById("bulk-status");
  const cancelBulkBtn = document.getElementById("btn-cancel-bulk");

  if (!bulkBtn) return;

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let progressListener: ((message: unknown) => void) | null = null;

  const startPolling = () => {
    if (pollInterval) return;
    pollInterval = setInterval(() => {
      chrome.tabs.sendMessage(tabId, { type: "GET_BULK_STATUS" });
    }, 1000);
  };

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (progressListener) {
      chrome.runtime.onMessage.removeListener(progressListener);
      progressListener = null;
    }
  };

  // Check if bulk mode is already active
  chrome.tabs.sendMessage(tabId, { type: "GET_BULK_STATUS" });

  progressListener = (message: unknown) => {
    const msg = message as {
      type: string;
      completed: number;
      total: number;
      queued: number;
      running: boolean;
    };
    if (msg.type !== "BULK_PROGRESS") return;

    if (msg.total > 0 || msg.running) {
      // Bulk mode is active — update UI
      bulkBtn.textContent = "⚡ Bulk Queue Active";
      bulkBtn.disabled = true;
      bulkBtn.style.background = "#1e1b4b";
      if (progressEl) progressEl.style.display = "flex";

      if (msg.queued > 0) {
        if (statusEl)
          statusEl.textContent = `${msg.queued} queued · ${msg.completed} scored`;
      } else if (msg.running) {
        if (statusEl)
          statusEl.textContent = `Analyzing... · ${msg.completed} scored`;
      } else {
        if (statusEl)
          statusEl.textContent = `✓ Done — ${msg.completed} jobs scored`;
        bulkBtn.textContent = "⚡ Enable Bulk Queue";
        bulkBtn.disabled = false;
        stopPolling();
        setTimeout(() => {
          if (progressEl) progressEl.style.display = "none";
        }, 3000);
      }
    }
  };

  chrome.runtime.onMessage.addListener(progressListener);

  bulkBtn.addEventListener("click", () => {
    // Enable bulk queue mode in content script
    chrome.tabs.sendMessage(tabId, { type: "START_BULK_SCORING" });

    bulkBtn.textContent = "⚡ Bulk Queue Active";
    bulkBtn.disabled = true;
    bulkBtn.style.background = "#1e1b4b";

    if (progressEl) progressEl.style.display = "flex";
    if (statusEl) statusEl.textContent = "Open cards to queue them for scoring";

    startPolling();
  });

  if (cancelBulkBtn) {
    cancelBulkBtn.addEventListener("click", () => {
      chrome.tabs.sendMessage(tabId, { type: "CANCEL_BULK_SCORING" });
      stopPolling();

      bulkBtn.textContent = "⚡ Enable Bulk Queue";
      bulkBtn.disabled = false;
      bulkBtn.style.background = "";

      if (progressEl) progressEl.style.display = "none";
      if (statusEl) statusEl.textContent = "Ready — open cards to queue them";
    });
  }
}

function attachActionListeners(tabUrl: string, jobId: string, jobTitle = "", company = ""): void {
  // Wire up bulk listeners if on hiring.cafe
  if (tabUrl.includes("hiring.cafe")) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) attachBulkListeners(tab.id);
    });
  }

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
          const cacheKey = `score_jobid_${jobId}`;
          chrome.storage.local.get(cacheKey, (data) => {
            const stored = data[cacheKey] as StoredScore | undefined;
            if (stored && stored.timestamp > Date.now() - 30000) {
              clearInterval(poll);
              chrome.storage.local.get(`applied_${jobId}`, (appliedData) => {
                const isApplied = !!appliedData[`applied_${jobId}`];
                showScore(stored, tabUrl, isApplied, jobId);
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

  wireReachButton(jobId, tabUrl, jobTitle, company);
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

function extractJobIdFromUrl(url: string): string | null {
  // LinkedIn
  const linkedInMatch = url.match(/currentJobId=(\d+)/);
  if (linkedInMatch) return linkedInMatch[1];

  const linkedInViewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (linkedInViewMatch) return linkedInViewMatch[1];

  // Indeed
  const vjkMatch = url.match(/[?&]vjk=([a-zA-Z0-9]+)/);
  if (vjkMatch) return vjkMatch[1];

  const jkMatch = url.match(/[?&]jk=([a-zA-Z0-9]+)/);
  if (jkMatch) return jkMatch[1];

  return null;
}

function isHiringCafe(url: string): boolean {
  return url.includes("hiring.cafe");
}

// Listen for auth-required message from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "AUTH_REQUIRED") renderNotSignedIn();
});

// Wire up header buttons (always, regardless of auth/tab state)
document.getElementById("btn-logout")?.addEventListener("click", () => {
  chrome.storage.local.remove("auth_jwt", () => renderNotSignedIn());
});
document.getElementById("btn-dashboard")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// Check auth before loading score
chrome.storage.local.get("auth_jwt", (authData) => {
  if (!authData.auth_jwt) {
    renderNotSignedIn();
    return;
  }
  proceedWithScoreLoad();
});

function proceedWithScoreLoad() {
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url) {
    renderEmpty();
    return;
  }

  const isSupported =
    (tab.url.includes("linkedin.com/jobs") &&
      (tab.url.includes("currentJobId=") || tab.url.includes("/jobs/view/"))) ||
    (tab.url.includes("indeed.com") &&
      (tab.url.includes("vjk=") ||
        tab.url.includes("jk=") ||
        tab.url.includes("/viewjob"))) ||
    tab.url.includes("hiring.cafe");

  if (!isSupported) {
    renderEmpty();
    return;
  }

  const urlJobId = extractJobIdFromUrl(tab.url);

  if (isHiringCafe(tab.url)) {
    const checkHiringCafe = (attempt: number) => {
      chrome.storage.local.get(null, (allData) => {
        const pendingJobId = allData["hc_pending_job_id"] as string | null;
        const activeJobId = allData["hc_active_job_id"] as string | null;
        const bulkModeActive = allData["hc_bulk_mode_active"] as boolean | null;

        // If the active job has a cached score, show it directly
        if (activeJobId && !bulkModeActive) {
          const activeKey = `score_jobid_${activeJobId}`;
          const activeStored = allData[activeKey] as StoredScore | undefined;
          if (activeStored?.result) {
            showScore(activeStored, tab.url!, false, activeJobId);
            return;
          }
          // Active job is known but not yet scored — check if analysis is running
          if (pendingJobId === activeJobId) {
            renderLoading();
            if (attempt < 20) {
              setTimeout(() => checkHiringCafe(attempt + 1), 1000);
            } else {
              renderError("Analysis timed out. Try reopening the job.");
            }
            return;
          }
        }

        // Fallback: bulk mode or no active job — sort by most recently analyzed
        const hcEntries = Object.entries(allData)
          .filter(([key]) => key.startsWith("score_jobid_hc_"))
          .map(([key, val]) => ({ key, stored: val as StoredScore }))
          .filter(({ stored }) => stored?.result != null)
          .sort(
            (a, b) => (b.stored.timestamp ?? 0) - (a.stored.timestamp ?? 0),
          );

        if (bulkModeActive) {
          if (hcEntries.length > 0) {
            const { key, stored } = hcEntries[0];
            const hcJobId = key.replace("score_jobid_", "");
            showScore(stored, tab.url!, false, hcJobId);
          } else {
            renderError("Bulk queue active. Open job cards to score them.");
          }
        } else if (pendingJobId) {
          renderLoading();
          if (attempt < 20) {
            setTimeout(() => checkHiringCafe(attempt + 1), 1000);
          } else {
            renderError("Analysis timed out. Try reopening the job.");
          }
        } else if (hcEntries.length > 0) {
          const { key, stored } = hcEntries[0];
          const hcJobId = key.replace("score_jobid_", "");
          renderScore(stored, tab.url!, false, hcJobId);
        } else if (attempt < 20) {
          renderLoading();
          setTimeout(() => checkHiringCafe(attempt + 1), 1000);
        } else {
          renderError(
            "No score found. Open a job listing on Hiring.cafe first.",
          );
        }
      });
    };
    checkHiringCafe(0);
    return;
  }

  if (!urlJobId) {
    renderLoading();
    return;
  }

  const cacheKey = `score_jobid_${urlJobId}`;
  chrome.storage.local.get(cacheKey, (data) => {
    const stored = data[cacheKey] as StoredScore | undefined;

    if (stored) {
      chrome.storage.local.get(`applied_${urlJobId}`, (appliedData) => {
        const isApplied = !!appliedData[`applied_${urlJobId}`];
        showScore(stored, tab.url!, isApplied, urlJobId);
      });
      return;
    }

    chrome.runtime.sendMessage(
      { type: "GET_SCORE_FROM_BACKEND", jobId: urlJobId },
      (response) => {
        if (response?.success) {
          const backendData = response.data;
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
              salary_estimate: backendData.salary_estimate,
            },
            jobTitle: backendData.job_title,
            company: backendData.company,
            timestamp: new Date(backendData.created_at).getTime(),
          };

          chrome.storage.local.set({ [cacheKey]: reconstructed });
          showScore(reconstructed, tab.url!, false, urlJobId);
        } else {
          renderLoading();
        }
      },
    );
  });

});

}
