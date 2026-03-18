console.log("[JobScout Overlay] Module loaded");

const OVERLAY_ID = "jobscout-overlay";
const TOGGLE_ID = "jobscout-overlay-toggle";

interface OverlayJob {
  jobId: string;
  jobTitle: string;
  company: string;
  score: number;
  shouldApply: boolean;
  salary: string | null;
  salaryEstimateLow: number | null;
  salaryEstimateHigh: number | null;
  easyApply: boolean;
  url: string;
}

let jobs: OverlayJob[] = [];
let isCollapsed = false;

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

function formatSalary(job: OverlayJob): string {
  if (job.salary) return job.salary;
  if (job.salaryEstimateLow && job.salaryEstimateHigh) {
    return `~$${Math.round(job.salaryEstimateLow / 1000)}k–$${Math.round(job.salaryEstimateHigh / 1000)}k`;
  }
  return "";
}

function injectStyles(): void {
  if (document.getElementById("jobscout-overlay-styles")) return;

  const style = document.createElement("style");
  style.id = "jobscout-overlay-styles";
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      top: 60px;
      right: 0;
      width: 260px;
      max-height: calc(100vh - 80px);
      background: #0f172a;
      border: 1px solid #1e293b;
      border-right: none;
      border-radius: 8px 0 0 8px;
      z-index: 9998;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: -4px 0 24px rgba(0,0,0,0.4);
      transition: transform 0.2s ease;
    }
    #${OVERLAY_ID}.collapsed {
      transform: translateX(260px);
    }
    #${OVERLAY_ID} .jobscout-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid #1e293b;
      flex-shrink: 0;
    }
    #${OVERLAY_ID} .jobscout-overlay-title {
      font-size: 12px;
      font-weight: 600;
      color: #38bdf8;
    }
    #${OVERLAY_ID} .jobscout-overlay-count {
      font-size: 11px;
      color: #475569;
    }
    #${OVERLAY_ID} .jobscout-overlay-sort {
      font-size: 11px;
      color: #475569;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      border: 1px solid #334155;
      background: none;
      white-space: nowrap;
    }
    #${OVERLAY_ID} .jobscout-overlay-sort:hover {
      color: #94a3b8;
      border-color: #475569;
    }
    #${OVERLAY_ID} .jobscout-overlay-list {
      overflow-y: auto;
      flex: 1;
      padding: 6px;
      scrollbar-width: thin;
      scrollbar-color: #1e293b transparent;
    }
    #${OVERLAY_ID} .jobscout-overlay-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      margin-bottom: 4px;
      cursor: pointer;
      border: 1px solid #1e293b;
      background: #111827;
      transition: background 0.1s;
    }
    #${OVERLAY_ID} .jobscout-overlay-item:hover {
      background: #1e293b;
    }
    #${OVERLAY_ID} .jobscout-overlay-item.active {
      border-color: #334155;
      background: #1a2744;
    }
    #${OVERLAY_ID} .jobscout-score-pill {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
    }
    #${OVERLAY_ID} .jobscout-job-info {
      flex: 1;
      min-width: 0;
    }
    #${OVERLAY_ID} .jobscout-job-title {
      font-size: 11px;
      font-weight: 500;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${OVERLAY_ID} .jobscout-job-company {
      font-size: 10px;
      color: #64748b;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${OVERLAY_ID} .js-job-meta {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    #${OVERLAY_ID} .jobscout-meta-tag {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 500;
    }
    #${OVERLAY_ID} .jobscout-overlay-empty {
      padding: 20px 12px;
      text-align: center;
      font-size: 11px;
      color: #475569;
      line-height: 1.6;
    }
#${TOGGLE_ID} {
      position: absolute;
      top: 50%;
      left: -21px;
      transform: translateY(-50%);
      width: 20px;
      height: 48px;
      background: #1e293b;
      border: 1px solid #334155;
      border-right: none;
      border-radius: 6px 0 0 6px;
      z-index: 9999;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 12px;
      transition: background 0.15s, color 0.15s;
    }
    #${TOGGLE_ID}:hover {
      background: #334155;
      color: #94a3b8;
    }
  `;
  document.head.appendChild(style);
}

function buildJobItem(job: OverlayJob, isActive: boolean): HTMLElement {
  const { bg, text, border } = getScoreColor(job.score);
  const salary = formatSalary(job);

  const item = document.createElement("div");
  item.className = `jobscout-overlay-item${isActive ? " active" : ""}`;
  item.setAttribute("data-job-id", job.jobId);

  const applyColor = job.shouldApply ? "#4ade80" : "#f87171";
  const applyText = job.shouldApply ? "✓ Apply" : "✗ Skip";

  item.innerHTML = `
    <div class="jobscout-score-pill" style="background:${bg};color:${text};border:1px solid ${border}">
      ${job.score}
    </div>
    <div class="jobscout-job-info">
      <div class="jobscout-job-title" title="${job.jobTitle} — ${job.company}">${job.jobTitle}</div>
      <div class="jobscout-job-company">${job.company}</div>
      <div class="js-job-meta">
        <span class="jobscout-meta-tag" style="background:${bg};color:${applyColor}">${applyText}</span>
        ${job.easyApply ? `<span class="jobscout-meta-tag" style="background:#0f2a1a;color:#6ee7b7">⚡</span>` : ""}
        ${salary ? `<span class="jobscout-meta-tag" style="background:#1a1a2e;color:#a78bfa">${salary}</span>` : ""}
      </div>
    </div>
  `;

  item.addEventListener("click", () => {
    const currentJobIdMatch = job.url.match(/currentJobId=(\d+)/);
    if (currentJobIdMatch) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("currentJobId", currentJobIdMatch[1]);
      window.history.pushState({}, "", newUrl.toString());
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (job.url.includes("hiring.cafe")) {
      const card = document.querySelector<HTMLElement>(
        `[data-jobscout-hc-id="${job.jobId}"]`,
      );
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.style.transition = "box-shadow 0.2s ease";
        card.style.boxShadow = "0 0 0 3px #38bdf8";
        setTimeout(() => {
          card.style.boxShadow = "";
        }, 1500);
      }
    } else {
      window.location.href = job.url;
    }
    updateActiveItem(job.jobId);
  });

  return item;
}

function getCurrentJobId(): string | null {
  const match = window.location.href.match(/currentJobId=(\d+)/);
  return match ? match[1] : null;
}

function updateActiveItem(activeJobId: string): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  overlay.querySelectorAll(".jobscout-overlay-item").forEach((item) => {
    const itemJobId = item.getAttribute("data-job-id");
    item.classList.toggle("active", itemJobId === activeJobId);
  });
}

let sortByScore = true;

function renderOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const list = overlay.querySelector(".jobscout-overlay-list");
  const countEl = overlay.querySelector(".jobscout-overlay-count");
  if (!list || !countEl) return;

  const currentJobId = getCurrentJobId();

  const sorted = [...jobs].sort((a, b) =>
    sortByScore ? b.score - a.score : 0,
  );

  countEl.textContent = `${jobs.length} scored`;
  list.innerHTML = "";

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="jobscout-overlay-empty">
        Click through job listings to see scores ranked here
      </div>
    `;
    return;
  }

  sorted.forEach((job) => {
    const isActive = job.jobId === currentJobId;
    list.appendChild(buildJobItem(job, isActive));
  });
}

function createOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return;

  injectStyles();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="${TOGGLE_ID}" title="Toggle JobScout overlay">›</div>
    <div class="jobscout-overlay-header">
      <span class="jobscout-overlay-title">JobScout</span>
      <span class="jobscout-overlay-count">0 scored</span>
      <button class="jobscout-overlay-sort" id="jobscout-sort-btn">↕ score</button>
    </div>
    <div class="jobscout-overlay-list">
      <div class="jobscout-overlay-empty">
        Click through job listings to see scores ranked here
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const toggle = document.getElementById(TOGGLE_ID);
  if (toggle) {
    toggle.addEventListener("click", () => {
      isCollapsed = !isCollapsed;
      overlay.classList.toggle("collapsed", isCollapsed);
      toggle.textContent = isCollapsed ? "‹" : "›";
    });
  }

  const sortBtn = document.getElementById("jobscout-sort-btn");
  if (sortBtn) {
    sortBtn.addEventListener("click", () => {
      sortByScore = !sortByScore;
      sortBtn.textContent = sortByScore ? "↕ score" : "↕ recent";
      renderOverlay();
    });
  }
}

export function addJobToOverlay(job: OverlayJob): void {
  const existing = jobs.findIndex((j) => j.jobId === job.jobId);
  if (existing >= 0) {
    jobs[existing] = job;
  } else {
    jobs.push(job);
  }

  if (!document.getElementById(OVERLAY_ID)) {
    createOverlay();
  }

  renderOverlay();
}

export function updateOverlayActiveJob(jobId: string): void {
  updateActiveItem(jobId);
}

export { OverlayJob };
