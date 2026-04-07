console.log("[JobScout Dashboard] Loaded");

interface SalaryEstimate {
  low: number;
  high: number;
  currency: string;
  per: string;
  confidence: string;
  assessment: string | null;
}

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
  url?: string;
  dbId?: number;
}

type AppStatus =
  | "applied"
  | "phone_screen"
  | "interviewed"
  | "offer"
  | "rejected"
  | null;

interface DashboardJob {
  jobId: string;
  jobTitle: string;
  company: string;
  score: number;
  shouldApply: boolean;
  verdict: string;
  salary: string | null;
  salaryEstimate: SalaryEstimate | null;
  site: string;
  timestamp: number;
  status: AppStatus;
  appliedDate: number | null;
  result: AnalyzeResponse;
  url: string | null;
  dbId?: number;
}

const STATUS_CYCLE: AppStatus[] = [
  "applied",
  "phone_screen",
  "interviewed",
  "offer",
  "rejected",
  null,
];

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; color: string; border: string }
> = {
  applied: {
    label: "Applied",
    bg: "#0c1a3a",
    color: "#38bdf8",
    border: "#1e3a5f",
  },
  phone_screen: {
    label: "Phone Screen",
    bg: "#1c1400",
    color: "#facc15",
    border: "#78350f",
  },
  interviewed: {
    label: "Interviewed",
    bg: "#1a0a2e",
    color: "#a78bfa",
    border: "#4c1d95",
  },
  offer: { label: "Offer", bg: "#052e16", color: "#4ade80", border: "#166534" },
  rejected: {
    label: "Rejected",
    bg: "#2d1515",
    color: "#f87171",
    border: "#7f1d1d",
  },
};

interface UserProfile {
  id: number;
  name: string;
  resume_text: string | null;
  instructions: string;
  is_active: boolean;
  created_at: string;
}

const DEFAULT_INSTRUCTIONS =
  "Analyze this job for overall fit based on my resume. " +
  "Highlight skill gaps and strengths, and flag any responsibilities " +
  "or requirements I should pay special attention to.";

let allJobs: DashboardJob[] = [];
let sortCol = "date";
let sortAsc = false;
let expandedJobId: string | null = null;
let profiles: UserProfile[] = [];
let editingProfileId: number | null = null;

function detectSite(jobId: string): string {
  if (jobId.startsWith("hc_")) return "hiring-cafe";
  if (/^\d+$/.test(jobId)) return "linkedin";
  return "indeed";
}

function formatSalary(job: DashboardJob): string {
  if (job.salary) return job.salary;
  if (job.salaryEstimate) {
    const low = Math.round(job.salaryEstimate.low / 1000);
    const high = Math.round(job.salaryEstimate.high / 1000);
    return `~$${low}k–$${high}k`;
  }
  return "—";
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getScoreStyle(score: number): {
  bg: string;
  text: string;
  border: string;
} {
  if (score >= 80) return { bg: "#052e16", text: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", text: "#facc15", border: "#854d0e" };
  if (score >= 40) return { bg: "#1c0a00", text: "#fb923c", border: "#9a3412" };
  return { bg: "#2d1515", text: "#f87171", border: "#7f1d1d" };
}

function getSiteBadgeClass(site: string): string {
  if (site === "linkedin") return "site-badge linkedin";
  if (site === "indeed") return "site-badge indeed";
  if (site === "hiring-cafe") return "site-badge hiring-cafe";
  return "site-badge";
}

function getSiteLabel(site: string): string {
  if (site === "linkedin") return "LinkedIn";
  if (site === "indeed") return "Indeed";
  if (site === "hiring-cafe") return "Hiring.cafe";
  return site;
}

function renderStatusBadge(status: AppStatus): string {
  if (!status) {
    return `<span class="status-badge status-none" title="Click to mark as Applied">+ Track</span>`;
  }
  const cfg = STATUS_CONFIG[status];
  return `<span class="status-badge" style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border}" title="Click to advance status">${cfg.label}</span>`;
}

function cycleStatus(current: AppStatus): AppStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function saveStatus(jobId: string, status: AppStatus, dbId?: number, appliedDate?: number | null): void {
  if (status === null) {
    chrome.storage.local.remove(`status_${jobId}`);
  } else {
    chrome.storage.local.set({ [`status_${jobId}`]: status });
  }
  // Sync to backend if we have a db row ID
  if (dbId) {
    chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATUS",
      jobId,
      dbId,
      status,
      appliedDate: status === "applied" && appliedDate ? new Date(appliedDate).toISOString() : null,
    });
  }
}

function openAndHighlightHC(jobId: string, url: string): void {
  chrome.tabs.query({ url: "https://hiring.cafe/*" }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(tabs[0].windowId!, { focused: true });

      let attempts = 0;
      const maxAttempts = 20;
      const poll = setInterval(() => {
        attempts++;
        chrome.tabs.sendMessage(
          tabId,
          { type: "HIGHLIGHT_HC_CARD", jobId },
          (response) => {
            if (chrome.runtime.lastError) {
              clearInterval(poll);
              return;
            }
            if (response?.found) {
              clearInterval(poll);
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              chrome.tabs.update(tabId, { url }, () => {
                chrome.tabs.onUpdated.addListener(
                  function listener(updatedId, info) {
                    if (updatedId === tabId && info.status === "complete") {
                      chrome.tabs.onUpdated.removeListener(listener);
                      setTimeout(
                        () =>
                          chrome.tabs.sendMessage(tabId, {
                            type: "HIGHLIGHT_HC_CARD",
                            jobId,
                          }),
                        1500,
                      );
                    }
                  },
                );
              });
            } else {
              chrome.tabs.sendMessage(tabId, { type: "SCROLL_TO_LOAD" });
            }
          },
        );
      }, 500);
    } else {
      chrome.tabs.create({ url }, (tab) => {
        if (!tab.id) return;
        const tabId = tab.id;
        chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
          if (updatedId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => {
              let attempts = 0;
              const maxAttempts = 20;
              const poll = setInterval(() => {
                attempts++;
                chrome.tabs.sendMessage(
                  tabId,
                  { type: "HIGHLIGHT_HC_CARD", jobId },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      clearInterval(poll);
                      return;
                    }
                    if (response?.found) {
                      clearInterval(poll);
                    } else if (attempts >= maxAttempts) {
                      clearInterval(poll);
                    } else {
                      chrome.tabs.sendMessage(tabId, {
                        type: "SCROLL_TO_LOAD",
                      });
                    }
                  },
                );
              }, 500);
            }, 1500);
          }
        });
      });
    }
  });
}

function loadJobs(): void {
  chrome.storage.local.get(null, (data) => {
    // Migrate old applied_ keys to status_ keys
    const migratePayload: Record<string, string> = {};
    Object.keys(data).forEach((k) => {
      if (k.startsWith("applied_") && data[k] === true) {
        const jobId = k.replace("applied_", "");
        if (!data[`status_${jobId}`]) {
          migratePayload[`status_${jobId}`] = "applied";
        }
      }
    });
    if (Object.keys(migratePayload).length > 0) {
      chrome.storage.local.set(migratePayload);
      Object.assign(data, migratePayload);
    }

    allJobs = Object.entries(data)
      .filter(([key]) => key.startsWith("score_jobid_"))
      .map(([key, val]) => {
        const stored = val as StoredScore;
        const jobId = key.replace("score_jobid_", "");
        const status = (data[`status_${jobId}`] as AppStatus) ?? null;
        const appliedDate = (data[`applied_date_${jobId}`] as number) ?? null;
        return {
          jobId,
          jobTitle: stored.jobTitle ?? "Unknown",
          company: stored.company ?? "Unknown",
          score: stored.result?.fit_score ?? 0,
          shouldApply: stored.result?.should_apply ?? false,
          verdict: stored.result?.one_line_verdict ?? "",
          salary: stored.salary ?? null,
          salaryEstimate: stored.result?.salary_estimate ?? null,
          site: detectSite(jobId),
          timestamp: stored.timestamp ?? 0,
          status,
          appliedDate,
          result: stored.result,
          url: stored.url ?? null,
          dbId: stored.dbId,
        };
      })
      .filter((j) => j.jobTitle && j.score !== undefined);

    renderStats();
    renderTable();
    updateCount();

    // Backfill dbId for jobs missing it, then sync status
    backfillDbIds().then(() => syncStatusFromBackend());
  });
}

async function backfillDbIds(): Promise<void> {
  const authData = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("auth_jwt", (result) => resolve(result)),
  );
  if (!authData.auth_jwt) return;
  const token = authData.auth_jwt as string;

  // Collect jobs missing a dbId
  const toBackfill = allJobs.filter((j) => !j.dbId);
  if (toBackfill.length === 0) return;

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/history/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jobs: toBackfill.map((j) => ({
          job_id: j.jobId,
          title: j.jobTitle,
          company: j.company,
        })),
      }),
    });
    if (!r.ok) return;
    const claimed: Array<{ job_id: string; db_id: number }> = await r.json();
    if (claimed.length === 0) return;

    // Build a jobId→db_id lookup
    const idToDbId = new Map(claimed.map((c) => [c.job_id, c.db_id]));

    // Update in-memory jobs and write back to local storage in one batch
    const storageUpdate: Record<string, StoredScore> = {};
    for (const job of toBackfill) {
      const dbId = idToDbId.get(job.jobId);
      if (!dbId) continue;
      job.dbId = dbId;
      const storageKey = `score_jobid_${job.jobId}`;
      await new Promise<void>((resolve) =>
        chrome.storage.local.get(storageKey, (d) => {
          const existing = d[storageKey] as StoredScore | undefined;
          if (existing) storageUpdate[storageKey] = { ...existing, dbId };
          resolve();
        }),
      );
    }
    if (Object.keys(storageUpdate).length > 0) {
      chrome.storage.local.set(storageUpdate);
    }
    console.log(`[JobScout] Backfilled dbId for ${Object.keys(storageUpdate).length} jobs`);
  } catch {
    // Backfill is best-effort — ignore errors
  }
}

async function syncStatusFromBackend(): Promise<void> {
  const authData = await new Promise<Record<string, unknown>>((resolve) =>
    chrome.storage.local.get("auth_jwt", (result) => resolve(result)),
  );
  if (!authData.auth_jwt) return;
  const token = authData.auth_jwt as string;

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/history?limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const backendJobs: Array<{ id: number; status: string | null; url?: string }> = await r.json();

    // Backend wins for jobs it already has a status for
    let changed = false;
    for (const bj of backendJobs) {
      if (!bj.status) continue;
      const local = allJobs.find((j) => j.dbId === bj.id);
      if (!local || local.status === bj.status) continue;
      local.status = bj.status as AppStatus;
      chrome.storage.local.set({ [`status_${local.jobId}`]: bj.status });
      changed = true;
    }
    if (changed) { renderStats(); renderTable(); }

    // Push every local status to the backend via push-statuses (handles duplicates correctly)
    const localWithStatus = allJobs.filter((j) => j.status !== null);
    if (localWithStatus.length === 0) return;

    const pushResp = await fetch(`${process.env.BACKEND_URL}/history/push-statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jobs: localWithStatus.map((j) => ({
          job_id: j.jobId,
          title: j.jobTitle,
          company: j.company,
          status: j.status!,
        })),
      }),
    });
    if (!pushResp.ok) return;
    const pushed: Array<{ job_id: string; db_id: number }> = await pushResp.json();
    console.log(`[JobScout] Pushed ${pushed.length} statuses to backend`);

    // Update dbIds in local storage for any that changed
    const storageUpdate: Record<string, StoredScore> = {};
    for (const p of pushed) {
      const local = allJobs.find((j) => j.jobId === p.job_id);
      if (!local || local.dbId === p.db_id) continue;
      local.dbId = p.db_id;
      const key = `score_jobid_${p.job_id}`;
      await new Promise<void>((resolve) =>
        chrome.storage.local.get(key, (d) => {
          const existing = d[key] as StoredScore | undefined;
          if (existing) storageUpdate[key] = { ...existing, dbId: p.db_id };
          resolve();
        }),
      );
    }
    if (Object.keys(storageUpdate).length > 0) chrome.storage.local.set(storageUpdate);
  } catch {
    // Silently ignore — sync is best-effort
  }
}

function applyStatFilter(action: string): void {
  const searchEl = document.getElementById("search") as HTMLInputElement | null;
  const siteEl = document.getElementById("filter-site") as HTMLSelectElement | null;
  const scoreEl = document.getElementById("filter-score") as HTMLInputElement | null;
  const scoreValEl = document.getElementById("score-val");
  const applyEl = document.getElementById("filter-apply") as HTMLSelectElement | null;
  const statusEl = document.getElementById("filter-status") as HTMLSelectElement | null;

  // Determine current active action so clicking again toggles off
  const currentApply = applyEl?.value ?? "all";
  const currentStatus = statusEl?.value ?? "all";
  const currentMinScore = parseInt(scoreEl?.value ?? "0");
  let currentAction: string | null = null;
  if (currentApply === "yes") currentAction = "apply:yes";
  else if (currentMinScore >= 70) currentAction = "score:70";
  else if (currentStatus !== "all") currentAction = `status:${currentStatus}`;

  // Reset all filters
  if (searchEl) searchEl.value = "";
  if (siteEl) siteEl.value = "all";
  if (scoreEl) { scoreEl.value = "0"; if (scoreValEl) scoreValEl.textContent = "0+"; }
  if (applyEl) applyEl.value = "all";
  if (statusEl) statusEl.value = "all";
  const appliedDateEl = document.getElementById("filter-applied-date") as HTMLSelectElement | null;
  if (appliedDateEl) appliedDateEl.value = "all";

  // Apply new filter only if it's different from the current one (toggle off if same)
  if (action !== "all" && action !== currentAction) {
    if (action === "apply:yes" && applyEl) applyEl.value = "yes";
    else if (action === "score:70" && scoreEl) { scoreEl.value = "70"; if (scoreValEl) scoreValEl.textContent = "70+"; }
    else if (action.startsWith("status:") && statusEl) statusEl.value = action.replace("status:", "");
  }

  renderTable();
  updateCount();
  renderStats();
}

function renderStats(): void {
  const bar = document.getElementById("stats-bar");
  if (!bar) return;

  const total = allJobs.length;
  const shouldApply = allJobs.filter((j) => j.shouldApply).length;
  const avgScore =
    total > 0
      ? Math.round(allJobs.reduce((s, j) => s + j.score, 0) / total)
      : 0;
  const high = allJobs.filter((j) => j.score >= 70).length;

  const applied = allJobs.filter((j) => j.status === "applied").length;
  const phoneScreen = allJobs.filter((j) => j.status === "phone_screen").length;
  const interviewed = allJobs.filter((j) => j.status === "interviewed").length;
  const offer = allJobs.filter((j) => j.status === "offer").length;
  const rejected = allJobs.filter((j) => j.status === "rejected").length;
  const totalApplied = applied + phoneScreen + interviewed + offer + rejected;

  const responseRate =
    totalApplied > 0
      ? Math.round(
          ((phoneScreen + interviewed + offer + rejected) / totalApplied) * 100,
        )
      : 0;
  const offerRate =
    totalApplied > 0 ? Math.round((offer / totalApplied) * 100) : 0;

  // Detect active filter for highlight
  const currentApply = (document.getElementById("filter-apply") as HTMLSelectElement | null)?.value ?? "all";
  const currentStatus = (document.getElementById("filter-status") as HTMLSelectElement | null)?.value ?? "all";
  const currentMinScore = parseInt((document.getElementById("filter-score") as HTMLInputElement | null)?.value ?? "0");
  let activeAction: string | null = null;
  if (currentApply === "yes") activeAction = "apply:yes";
  else if (currentMinScore >= 70) activeAction = "score:70";
  else if (currentStatus !== "all") activeAction = `status:${currentStatus}`;

  const stat = (
    value: number | string,
    label: string,
    valueStyle: string,
    action: string | null
  ) => {
    const isActive = action !== null && action === activeAction;
    const clickAttrs = action
      ? `data-action="${action}" style="cursor:pointer"`
      : "";
    const activeStyle = isActive
      ? `text-decoration:underline;text-underline-offset:3px;${valueStyle}`
      : valueStyle;
    return `
      <div class="stat" ${clickAttrs}>
        <span class="stat-value" style="${activeStyle}">${value}</span>
        <span class="stat-label">${label}</span>
      </div>`;
  };

  const divider = `<div style="width:1px;background:#1e293b;margin:0 8px;flex-shrink:0"></div>`;

  // Funnel bar widths relative to totalApplied
  const funnelMax = totalApplied || 1;
  const w = (n: number) => Math.round((n / funnelMax) * 100);

  bar.innerHTML =
    stat(total,        "Scored",       "",                    "all") +
    stat(shouldApply,  "Apply Recs",   "color:#4ade80",       "apply:yes") +
    stat(high,         "Score ≥70",    "color:#facc15",       "score:70") +
    stat(avgScore,     "Avg Score",    "",                    null) +
    divider +
    stat(totalApplied, "Applied",      "color:#38bdf8",       "status:any") +
    stat(phoneScreen,  "Phone Screen", "color:#facc15",       "status:phone_screen") +
    stat(interviewed,  "Interviewed",  "color:#a78bfa",       "status:interviewed") +
    stat(offer,        "Offers",       "color:#4ade80",       "status:offer") +
    stat(rejected,     "Rejected",     "color:#f87171",       "status:rejected") +
    divider +
    stat(`${responseRate}%`, "Response Rate", "color:#94a3b8", null) +
    stat(`${offerRate}%`,    "Offer Rate",    "color:#4ade80",  null) +
    (totalApplied > 0
      ? `
    <div style="flex:1;min-width:120px;display:flex;flex-direction:column;gap:4px;justify-content:center">
      <div style="font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Funnel</div>
      <div style="display:flex;flex-direction:column;gap:3px">
        ${[
          { label: "Applied",   n: totalApplied, color: "#38bdf8" },
          { label: "Screen",    n: phoneScreen,  color: "#facc15" },
          { label: "Interview", n: interviewed,  color: "#a78bfa" },
          { label: "Offer",     n: offer,        color: "#4ade80" },
        ]
          .map(
            (s) => `
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:56px;font-size:9px;color:#475569;text-align:right;flex-shrink:0">${s.label}</div>
            <div style="flex:1;height:5px;background:#1e293b;border-radius:3px;overflow:hidden">
              <div style="width:${w(s.n)}%;height:100%;background:${s.color};border-radius:3px;transition:width 0.3s"></div>
            </div>
            <div style="font-size:9px;color:${s.color};width:16px;flex-shrink:0">${s.n}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>`
      : "");

  // Wire click handlers for filterable stats
  bar.querySelectorAll<HTMLElement>(".stat[data-action]").forEach((el) => {
    el.addEventListener("click", () => {
      applyStatFilter(el.getAttribute("data-action")!);
    });
  });
}

function getFilteredJobs(): DashboardJob[] {
  const search =
    (
      document.getElementById("search") as HTMLInputElement
    )?.value.toLowerCase() ?? "";
  const site =
    (document.getElementById("filter-site") as HTMLSelectElement)?.value ??
    "all";
  const minScore = parseInt(
    (document.getElementById("filter-score") as HTMLInputElement)?.value ?? "0",
  );
  const applyFilter =
    (document.getElementById("filter-apply") as HTMLSelectElement)?.value ??
    "all";
  const statusFilter =
    (document.getElementById("filter-status") as HTMLSelectElement)?.value ??
    "all";
  const appliedWithin =
    (document.getElementById("filter-applied-date") as HTMLSelectElement)?.value ?? "all";

  const appliedCutoff = appliedWithin !== "all"
    ? Date.now() - parseInt(appliedWithin) * 24 * 60 * 60 * 1000
    : null;

  return allJobs
    .filter((j) => {
      if (
        search &&
        !j.jobTitle.toLowerCase().includes(search) &&
        !j.company.toLowerCase().includes(search)
      )
        return false;
      if (site !== "all" && j.site !== site) return false;
      if (j.score < minScore) return false;
      if (applyFilter === "yes" && !j.shouldApply) return false;
      if (applyFilter === "no" && j.shouldApply) return false;
      if (statusFilter === "none" && j.status !== null) return false;
      if (statusFilter === "any" && j.status === null) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "none" &&
        statusFilter !== "any" &&
        j.status !== statusFilter
      )
        return false;
      if (appliedCutoff !== null) {
        if (!j.appliedDate || j.appliedDate < appliedCutoff) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortCol === "score") {
        av = a.score;
        bv = b.score;
      } else if (sortCol === "title") {
        av = a.jobTitle;
        bv = b.jobTitle;
      } else if (sortCol === "company") {
        av = a.company;
        bv = b.company;
      } else if (sortCol === "date") {
        av = a.timestamp;
        bv = b.timestamp;
      } else if (sortCol === "applied_date") {
        av = a.appliedDate ?? 0;
        bv = b.appliedDate ?? 0;
      } else if (sortCol === "site") {
        av = a.site;
        bv = b.site;
      } else if (sortCol === "apply") {
        av = a.shouldApply ? 1 : 0;
        bv = b.shouldApply ? 1 : 0;
      } else if (sortCol === "status") {
        av = a.status ?? "";
        bv = b.status ?? "";
      }

      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
}

function renderTable(): void {
  const tbody = document.getElementById("job-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!tbody || !emptyState) return;

  const jobs = getFilteredJobs();

  if (jobs.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  tbody.innerHTML = "";

  jobs.forEach((job) => {
    const { bg, text, border } = getScoreStyle(job.score);
    const salary = formatSalary(job);
    const isExpanded = expandedJobId === job.jobId;

    const tr = document.createElement("tr");
    tr.setAttribute("data-job-id", job.jobId);
    tr.innerHTML = `
      <td>
        <button class="expand-btn" data-job-id="${job.jobId}" title="${isExpanded ? "Collapse" : "Expand"}">${isExpanded ? "▲" : "▼"}</button>
      </td>
      <td>
        <div class="score-pill" style="background:${bg};color:${text};border:1px solid ${border}">${job.score}</div>
      </td>
      <td>
        <div class="job-title" title="${job.jobTitle}">
          ${
            job.url
              ? `<a href="${job.url}" target="_blank"
                class="job-title-link"
                data-job-id="${job.jobId}"
                data-site="${job.site}"
                data-url="${job.url}"
                style="color:#e2e8f0;text-decoration:none;cursor:pointer;"
                onmouseover="this.style.color='#38bdf8'"
                onmouseout="this.style.color='#e2e8f0'">${job.jobTitle}</a>`
              : job.jobTitle
          }
        </div>
        <div class="company">${job.company}</div>
      </td>
      <td class="company">${job.company}</td>
      <td class="salary-cell">${salary}</td>
      <td><span class="${getSiteBadgeClass(job.site)}">${getSiteLabel(job.site)}</span></td>
      <td><span class="apply-pill ${job.shouldApply ? "yes" : "no"}">${job.shouldApply ? "✓ Apply" : "✗ Skip"}</span></td>
      <td style="text-align:center;white-space:nowrap">
        <span class="status-cycle-btn" data-job-id="${job.jobId}" style="cursor:pointer">
          ${renderStatusBadge(job.status)}
        </span>
        ${(job.status === "phone_screen" || job.status === "interviewed")
          ? `<button class="prep-btn" data-job-id="${job.jobId}" title="Open Interview Prep">📋 Prep</button>`
          : ""}
        <button class="app-btn" data-job-id="${job.jobId}" title="Open Application Assistance">📝 Application</button>
      </td>
      <td class="date-cell">${job.appliedDate ? formatDate(job.appliedDate) : "<span style='color:#334155'>—</span>"}</td>
      <td class="date-cell">${formatDate(job.timestamp)}</td>
    `;
    tbody.appendChild(tr);

    if (isExpanded) {
      const detailTr = document.createElement("tr");
      detailTr.className = "detail-row";
      detailTr.innerHTML = `
        <td colspan="10">
          <div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:12px">${job.verdict}</div>
          <div class="detail-grid">
            <div class="detail-section green">
              <h4>✓ Direct Matches (${job.result.direct_matches?.length ?? 0})</h4>
              <ul>${(job.result.direct_matches ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            <div class="detail-section">
              <h4>↔ Transferable (${job.result.transferable?.length ?? 0})</h4>
              <ul>${(job.result.transferable ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            <div class="detail-section red">
              <h4>✗ Gaps (${job.result.gaps?.length ?? 0})</h4>
              <ul>${(job.result.gaps ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
          </div>
          ${
            job.result.green_flags?.length || job.result.red_flags?.length
              ? `
          <div class="detail-grid" style="margin-top:12px">
            <div class="detail-section green">
              <h4>🟢 Green Flags</h4>
              <ul>${(job.result.green_flags ?? []).map((f) => `<li>${f}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            <div class="detail-section red">
              <h4>🔴 Red Flags</h4>
              <ul>${(job.result.red_flags ?? []).map((f) => `<li>${f}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            ${
              job.result.salary_estimate
                ? `
            <div class="detail-section">
              <h4>💰 Salary Estimate</h4>
              <ul>
                <li>$${Math.round(job.result.salary_estimate.low / 1000)}k – $${Math.round(job.result.salary_estimate.high / 1000)}k/yr</li>
                <li>Confidence: ${job.result.salary_estimate.confidence}</li>
                ${job.result.salary_estimate.assessment ? `<li>${job.result.salary_estimate.assessment}</li>` : ""}
              </ul>
            </div>`
                : "<div></div>"
            }
          </div>`
              : ""
          }
        </td>
      `;
      tbody.appendChild(detailTr);
    }
  });

  // Expand/collapse
  tbody.querySelectorAll(".expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const jobId = (btn as HTMLElement).getAttribute("data-job-id")!;
      expandedJobId = expandedJobId === jobId ? null : jobId;
      renderTable();
    });
  });

  // Status cycle click
  tbody.querySelectorAll(".status-cycle-btn").forEach((el) => {
    el.addEventListener("click", () => {
      const jobId = (el as HTMLElement).getAttribute("data-job-id")!;
      const job = allJobs.find((j) => j.jobId === jobId);
      if (!job) return;
      const nextStatus = cycleStatus(job.status);

      // Record applied date when first tracked; clear when reset to null
      if (job.status === null && nextStatus !== null && !job.appliedDate) {
        job.appliedDate = Date.now();
        chrome.storage.local.set({ [`applied_date_${jobId}`]: job.appliedDate });
      } else if (nextStatus === null && job.appliedDate) {
        job.appliedDate = null;
        chrome.storage.local.remove(`applied_date_${jobId}`);
      }

      job.status = nextStatus;
      saveStatus(jobId, nextStatus, job.dbId, job.appliedDate);
      renderTable();
      renderStats();
    });
  });

  // Interview prep button
  tbody.querySelectorAll<HTMLButtonElement>(".prep-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const jobId = btn.getAttribute("data-job-id")!;
      chrome.tabs.create({
        url: chrome.runtime.getURL("interview.html") + "#" + jobId,
      });
    });
  });

  // Application assistance button
  tbody.querySelectorAll<HTMLButtonElement>(".app-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const jobId = btn.getAttribute("data-job-id")!;
      chrome.tabs.create({
        url: chrome.runtime.getURL("app-assist.html") + "#" + jobId,
      });
    });
  });

  // HC link intercept
  tbody
    .querySelectorAll<HTMLAnchorElement>(".job-title-link")
    .forEach((link) => {
      link.addEventListener("click", (e) => {
        const site = link.getAttribute("data-site");
        if (site === "hiring-cafe") {
          e.preventDefault();
          const jobId = link.getAttribute("data-job-id")!;
          const url = link.getAttribute("data-url")!;
          openAndHighlightHC(jobId, url);
        }
      });
    });
}

function updateCount(): void {
  const countEl = document.getElementById("job-count");
  if (countEl) {
    const filtered = getFilteredJobs().length;
    countEl.textContent =
      filtered === allJobs.length
        ? `${allJobs.length} jobs scored`
        : `${filtered} of ${allJobs.length} jobs`;
  }
}

function exportCSV(): void {
  const jobs = getFilteredJobs();
  const headers = [
    "Score",
    "Job Title",
    "Company",
    "Salary",
    "Site",
    "Recommend",
    "Status",
    "Applied Date",
    "Verdict",
    "Analyzed",
    "URL",
  ];
  const rows = jobs.map((j) => [
    j.score,
    `"${j.jobTitle.replace(/"/g, '""')}"`,
    `"${j.company.replace(/"/g, '""')}"`,
    `"${formatSalary(j)}"`,
    getSiteLabel(j.site),
    j.shouldApply ? "Apply" : "Skip",
    j.status ? STATUS_CONFIG[j.status].label : "Not Tracked",
    j.appliedDate ? new Date(j.appliedDate).toLocaleDateString() : "",
    `"${j.verdict.replace(/"/g, '""')}"`,
    new Date(j.timestamp).toLocaleDateString(),
    j.url ? `"${j.url}"` : "",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobscout-history-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Controls
document.getElementById("search")?.addEventListener("input", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-site")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-score")?.addEventListener("input", (e) => {
  const val = (e.target as HTMLInputElement).value;
  const el = document.getElementById("score-val");
  if (el) el.textContent = `${val}+`;
  renderTable();
  updateCount();
});
document.getElementById("filter-apply")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-status")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-applied-date")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});

document.getElementById("btn-export")?.addEventListener("click", exportCSV);

document.getElementById("btn-clear")?.addEventListener("click", () => {
  if (!confirm("Clear all scored job history? This cannot be undone.")) return;
  chrome.storage.local.get(null, (data) => {
    const toRemove = Object.keys(data).filter(
      (k) => k.startsWith("score_jobid_") || k.startsWith("jobid_"),
    );
    chrome.storage.local.remove(toRemove, () => {
      allJobs = [];
      renderStats();
      renderTable();
      updateCount();
    });
  });
});

// Sort headers
document.querySelectorAll("thead th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-col")!;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col === "title" || col === "company";
    }
    document
      .querySelectorAll("thead th")
      .forEach((t) => t.classList.remove("sorted"));
    th.classList.add("sorted");
    th.textContent =
      th.textContent!.replace(" ↑", "").replace(" ↓", "") +
      (sortAsc ? " ↑" : " ↓");
    renderTable();
  });
});

// Tab switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = (btn as HTMLElement).getAttribute("data-tab")!;
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`)?.classList.add("active");
    if (tab === "filters") renderFilters();
    if (tab === "account") loadAccountTab();
    if (tab === "reach") renderReachTab();
    if (tab === "history") {
      renderTable();
      updateCount();
    }
  });
});

const activeTab = document
  .querySelector(".tab-btn.active")
  ?.getAttribute("data-tab");
if (activeTab === "filters") renderFilters();

function renderFilters(): void {
  renderHiddenJobs();
  renderLearnedKeywords();
}

function renderHiddenJobs(): void {
  const container = document.getElementById("hidden-jobs-list");
  if (!container) return;

  chrome.storage.local.get(null, (data) => {
    const hiddenKeys = Object.keys(data).filter((k) =>
      k.startsWith("user_dimmed_"),
    );

    if (hiddenKeys.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px">No manually hidden jobs.</div>`;
      return;
    }

    const jobIds = hiddenKeys.map((k) => k.replace("user_dimmed_", ""));
    const scoreKeys = jobIds.map((id) => `score_jobid_${id}`);

    chrome.storage.local.get(scoreKeys, (scores) => {
      container.innerHTML = "";
      jobIds.forEach((jobId) => {
        const scoreEntry = scores[`score_jobid_${jobId}`] as
          | { jobTitle?: string; company?: string }
          | undefined;
        const dimmedEntry = data[`user_dimmed_${jobId}`];
        const dimmedMeta =
          dimmedEntry && typeof dimmedEntry === "object"
            ? (dimmedEntry as { title?: string; company?: string })
            : null;
        const title = scoreEntry?.jobTitle ?? dimmedMeta?.title ?? jobId;
        const company =
          scoreEntry?.company ?? dimmedMeta?.company ?? "Unknown company";

        const row = document.createElement("div");
        row.className = "filter-row";
        row.innerHTML = `
          <div class="filter-row-info">
            <div class="filter-row-title">${title}</div>
            <div class="filter-row-meta">${company}</div>
          </div>
          <div class="filter-row-actions">
            <button class="btn-unhide" data-job-id="${jobId}">👁 Show</button>
          </div>
        `;
        container.appendChild(row);

        row.querySelector(".btn-unhide")?.addEventListener("click", () => {
          chrome.storage.local.remove(`user_dimmed_${jobId}`, () => {
            chrome.storage.local.set({ [`user_undimmed_${jobId}`]: true });
            row.remove();
            if (container.children.length === 0) {
              container.innerHTML = `<div class="empty-state" style="padding:20px">No manually hidden jobs.</div>`;
            }
          });
        });
      });
    });
  });
}

function renderLearnedKeywords(): void {
  const container = document.getElementById("learned-keywords-list");
  if (!container) return;

  chrome.storage.local.get(null, (data) => {
    const hideKeys = Object.keys(data).filter((k) => k.startsWith("kw_hide_"));

    if (hideKeys.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px">No learned keywords yet.</div>`;
      return;
    }

    const ngrams = hideKeys.map((k) => k.replace("kw_hide_", ""));
    const showKeys = ngrams.map((ng) => `kw_show_${ng}`);

    chrome.storage.local.get(showKeys, (showData) => {
      const entries = ngrams
        .map((ng) => {
          const hideCount = (data[`kw_hide_${ng}`] as number) ?? 0;
          const showCount = (showData[`kw_show_${ng}`] as number) ?? 0;
          const total = hideCount + showCount;
          const confidence = total > 0 ? hideCount / total : 0;
          return { ng, hideCount, showCount, confidence };
        })
        .sort(
          (a, b) => b.confidence - a.confidence || b.hideCount - a.hideCount,
        );

      container.innerHTML = "";
      entries.forEach(({ ng, hideCount, showCount, confidence }) => {
        const isActive = hideCount >= 3 && confidence >= 0.7;
        const pct = Math.round(confidence * 100);

        const row = document.createElement("div");
        row.className = "filter-row";
        row.innerHTML = `
          <div class="filter-row-info">
            <div class="filter-row-title">
              <span class="kw-tag">${ng}</span>
              ${
                isActive
                  ? `<span style="margin-left:8px;font-size:10px;color:#f87171">● auto-dimming</span>`
                  : `<span style="margin-left:8px;font-size:10px;color:#475569">building signal</span>`
              }
            </div>
            <div class="filter-row-meta">${hideCount} hides · ${showCount} shows · ${pct}% confidence</div>
          </div>
          <div class="filter-row-actions">
            <div class="confidence-bar-wrap">
              <div class="confidence-bar" style="width:${pct}%;opacity:${isActive ? 1 : 0.4}"></div>
            </div>
            <button class="btn-reset-kw" data-ng="${ng}">Reset</button>
          </div>
        `;
        container.appendChild(row);

        row.querySelector(".btn-reset-kw")?.addEventListener("click", () => {
          chrome.storage.local.remove(
            [`kw_hide_${ng}`, `kw_show_${ng}`],
            () => {
              row.remove();
              if (container.children.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding:20px">No learned keywords yet.</div>`;
              }
            },
          );
        });
      });
    });
  });
}

// ── Account tab ─────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  return new Promise((resolve) =>
    chrome.storage.local.get("auth_jwt", (d) => resolve((d.auth_jwt as string) ?? null)),
  );
}

function setMsg(id: string, text: string, type: "success" | "error" | "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `account-msg${type ? " " + type : ""}`;
}

async function loadAccountTab(): Promise<void> {
  const token = await getToken();
  if (!token) return;

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return;
    const user: { email: string; first_name?: string | null; last_name?: string | null; has_api_key: boolean; created_at: string } = await r.json();

    (document.getElementById("acc-first") as HTMLInputElement).value = user.first_name ?? "";
    (document.getElementById("acc-last") as HTMLInputElement).value = user.last_name ?? "";
    (document.getElementById("acc-email") as HTMLInputElement).value = user.email;
    if (user.has_api_key) {
      (document.getElementById("acc-api-key") as HTMLInputElement).placeholder = "sk-ant-••••••••••••••••••••";
    }
    const meta = document.getElementById("acc-meta");
    if (meta) {
      const joined = new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      meta.textContent = `Signed in as ${user.email} · Member since ${joined}`;
    }
  } catch {
    // ignore
  }
}

// ── Profile API helpers ──────────────────────────────────────────────────────

async function fetchProfiles(): Promise<UserProfile[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/profiles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
}

async function createProfile(name: string, resumeText: string, instructions: string): Promise<UserProfile> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const r = await fetch(`${process.env.BACKEND_URL}/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, resume_text: resumeText || null, instructions }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to create profile");
  return r.json();
}

async function updateProfile(id: number, name: string, resumeText: string, instructions: string): Promise<UserProfile> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, resume_text: resumeText || null, instructions }),
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to update profile");
  return r.json();
}

async function deleteProfileById(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to delete profile");
}

async function activateProfileById(id: number): Promise<void> {
  const token = await getToken();
  if (!token) return;
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/${id}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Failed to activate profile");
}

async function parseResumeFile(file: File): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${process.env.BACKEND_URL}/profiles/parse-resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!r.ok) throw new Error((await r.json()).detail ?? "Failed to parse resume");
  const data: { text: string } = await r.json();
  return data.text;
}

// ── Profile UI ───────────────────────────────────────────────────────────────

function renderProfiles(): void {
  const list = document.getElementById("profiles-list");
  const label = document.getElementById("active-profile-label");
  if (!list) return;

  const active = profiles.find((p) => p.is_active);
  if (label) label.textContent = active ? `— ${active.name}` : "";

  if (profiles.length === 0) {
    list.innerHTML = `<div style="color:#64748b;font-size:13px;padding:12px 0">No profiles yet. Create one to start analyzing jobs.</div>`;
    return;
  }

  list.innerHTML = profiles
    .map(
      (p) => `
    <div class="profile-card${p.is_active ? " is-active" : ""}" data-id="${p.id}">
      <div class="profile-card-left">
        <span class="profile-card-name">${p.name}</span>
        ${p.is_active ? '<span class="active-badge">Active</span>' : ""}
      </div>
      <div class="profile-card-actions">
        ${!p.is_active ? `<button class="btn-profile-action activate" data-action="activate" data-id="${p.id}">Set Active</button>` : ""}
        <button class="btn-profile-action" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="btn-profile-action delete" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    </div>`
    )
    .join("");
}

function openProfileEditor(profile?: UserProfile): void {
  editingProfileId = profile?.id ?? null;
  const editor = document.getElementById("profile-editor");
  const nameInput = document.getElementById("profile-name-input") as HTMLInputElement;
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  const instructions = document.getElementById("profile-instructions") as HTMLTextAreaElement;
  const status = document.getElementById("resume-parse-status");
  const msg = document.getElementById("profile-editor-msg");

  if (!editor || !nameInput || !resumeText || !instructions) return;

  nameInput.value = profile?.name ?? "";
  resumeText.value = profile?.resume_text ?? "";
  instructions.value = profile?.instructions ?? DEFAULT_INSTRUCTIONS;
  if (status) status.textContent = "";
  if (msg) { msg.textContent = ""; msg.className = "account-msg"; }

  editor.style.display = "block";
  nameInput.focus();
}

function closeProfileEditor(): void {
  const editor = document.getElementById("profile-editor");
  if (editor) editor.style.display = "none";
  editingProfileId = null;
}

async function loadProfilesPanel(): Promise<void> {
  profiles = await fetchProfiles();
  renderProfiles();
}

// ── Account sidebar navigation ───────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>(".account-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".account-nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".account-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panelId = `panel-${btn.dataset.panel}`;
    document.getElementById(panelId)?.classList.add("active");
    if (btn.dataset.panel === "profiles") loadProfilesPanel();
  });
});

// New profile button
document.getElementById("btn-new-profile")?.addEventListener("click", () => openProfileEditor());

// Profile list — event delegation for activate / edit / delete
document.getElementById("profiles-list")?.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLButtonElement>("[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === "activate") {
    try {
      await activateProfileById(id);
      profiles = await fetchProfiles();
      renderProfiles();
    } catch (err) {
      console.error("Activate failed:", err);
    }
  } else if (action === "edit") {
    const profile = profiles.find((p) => p.id === id);
    if (profile) openProfileEditor(profile);
  } else if (action === "delete") {
    const name = profiles.find((p) => p.id === id)?.name ?? "this profile";
    if (!confirm(`Delete profile "${name}"?`)) return;
    try {
      await deleteProfileById(id);
      profiles = profiles.filter((p) => p.id !== id);
      renderProfiles();
      closeProfileEditor();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }
});

// Resume upload button
document.getElementById("btn-upload-resume")?.addEventListener("click", () => {
  document.getElementById("profile-resume-file")?.click();
});

document.getElementById("profile-resume-file")?.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const status = document.getElementById("resume-parse-status");
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  if (status) status.textContent = "Extracting text…";
  try {
    const text = await parseResumeFile(file);
    if (resumeText) resumeText.value = text;
    if (status) status.textContent = "Text extracted — review and edit below.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Upload failed";
    if (status) status.textContent = msg;
  }
  input.value = "";
});

// Save profile editor
document.getElementById("btn-save-profile-edit")?.addEventListener("click", async () => {
  const nameInput = document.getElementById("profile-name-input") as HTMLInputElement;
  const resumeText = document.getElementById("profile-resume-text") as HTMLTextAreaElement;
  const instructions = document.getElementById("profile-instructions") as HTMLTextAreaElement;
  const msg = document.getElementById("profile-editor-msg");

  const name = nameInput?.value.trim();
  if (!name) {
    if (msg) { msg.textContent = "Profile name is required."; msg.className = "account-msg error"; }
    return;
  }

  try {
    if (editingProfileId !== null) {
      await updateProfile(editingProfileId, name, resumeText?.value ?? "", instructions?.value ?? DEFAULT_INSTRUCTIONS);
    } else {
      await createProfile(name, resumeText?.value ?? "", instructions?.value ?? DEFAULT_INSTRUCTIONS);
    }
    profiles = await fetchProfiles();
    renderProfiles();
    closeProfileEditor();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Save failed";
    if (msg) { msg.textContent = errMsg; msg.className = "account-msg error"; }
  }
});

// Cancel profile editor
document.getElementById("btn-cancel-profile-edit")?.addEventListener("click", closeProfileEditor);

// ── Account Details save handlers ────────────────────────────────────────────

document.getElementById("btn-save-profile")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-profile") as HTMLButtonElement;
  const token = await getToken();
  if (!token) return;

  const first = (document.getElementById("acc-first") as HTMLInputElement).value.trim();
  const last = (document.getElementById("acc-last") as HTMLInputElement).value.trim();
  const email = (document.getElementById("acc-email") as HTMLInputElement).value.trim();

  btn.disabled = true;
  setMsg("profile-msg", "", "");

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ first_name: first || null, last_name: last || null, email: email || undefined }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Save failed");
    setMsg("profile-msg", "Profile updated.", "success");
    const meta = document.getElementById("acc-meta");
    if (meta) meta.textContent = `Signed in as ${(data as { email: string }).email}`;
  } catch (err) {
    setMsg("profile-msg", (err as Error).message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-save-password")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-password") as HTMLButtonElement;
  const token = await getToken();
  if (!token) return;

  const curPw = (document.getElementById("acc-cur-pw") as HTMLInputElement).value;
  const newPw = (document.getElementById("acc-new-pw") as HTMLInputElement).value;
  const confirmPw = (document.getElementById("acc-confirm-pw") as HTMLInputElement).value;

  if (!curPw || !newPw) { setMsg("password-msg", "All password fields are required.", "error"); return; }
  if (newPw !== confirmPw) { setMsg("password-msg", "New passwords do not match.", "error"); return; }

  btn.disabled = true;
  setMsg("password-msg", "", "");

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_password: curPw, new_password: newPw }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Update failed");
    setMsg("password-msg", "Password updated.", "success");
    (document.getElementById("acc-cur-pw") as HTMLInputElement).value = "";
    (document.getElementById("acc-new-pw") as HTMLInputElement).value = "";
    (document.getElementById("acc-confirm-pw") as HTMLInputElement).value = "";
  } catch (err) {
    setMsg("password-msg", (err as Error).message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-save-apikey")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-apikey") as HTMLButtonElement;
  const token = await getToken();
  if (!token) return;

  const key = (document.getElementById("acc-api-key") as HTMLInputElement).value.trim();
  if (!key) { setMsg("apikey-msg", "Enter your Anthropic API key.", "error"); return; }

  btn.disabled = true;
  setMsg("apikey-msg", "", "");

  try {
    const r = await fetch(`${process.env.BACKEND_URL}/auth/api-key`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ api_key: key }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Save failed");
    setMsg("apikey-msg", "API key saved.", "success");
    (document.getElementById("acc-api-key") as HTMLInputElement).value = "";
    (document.getElementById("acc-api-key") as HTMLInputElement).placeholder = "sk-ant-••••••••••••••••••••";
  } catch (err) {
    setMsg("apikey-msg", (err as Error).message, "error");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-logout")?.addEventListener("click", () => {
  chrome.storage.local.remove("auth_jwt", () => {
    chrome.runtime.sendMessage({ type: "LOGOUT" });
    window.close();
  });
});

// ── Reach tab ───────────────────────────────────────────────────────────────

interface ReachJob {
  jobId: string;
  title: string;
  company: string;
  url: string;
  site: string;
  skills?: string[];
  description?: string;
  groupId?: string;
  timestamp: number;
}

interface ReachGroup {
  name: string;
}

interface ReachAnalysis {
  group_name: string;
  skill_themes: { skill: string; frequency: number; detail: string }[];
  experience_gaps: { gap: string; detail: string }[];
  actionable_steps: { step: string; detail: string }[];
  summary: string;
}

// In-memory state for the reach tab
let reachJobs: ReachJob[] = [];
let reachGroups: Record<string, ReachGroup> = {};
let reachAnalyses: Record<string, ReachAnalysis> = {};

function loadReachData(cb: () => void): void {
  chrome.storage.local.get(null, (data) => {
    reachJobs = Object.entries(data)
      .filter(([k]) => k.startsWith("reach_jobid_"))
      .map(([, v]) => v as ReachJob)
      .sort((a, b) => b.timestamp - a.timestamp);

    reachGroups = (data["reach_groups"] as Record<string, ReachGroup>) ?? {};
    cb();
  });
}

function saveReachGroups(): void {
  chrome.storage.local.set({ reach_groups: reachGroups });
}

function saveReachJob(job: ReachJob): void {
  chrome.storage.local.set({ [`reach_jobid_${job.jobId}`]: job });
}

function promptNewGroup(): string | null {
  const name = window.prompt("Group name:");
  return name?.trim() || null;
}

function renderReachTab(): void {
  loadReachData(() => {
    const content = document.getElementById("reach-content");
    const countEl = document.getElementById("reach-count");
    if (!content) return;

    if (countEl) {
      countEl.textContent = reachJobs.length === 1 ? "1 job" : `${reachJobs.length} jobs`;
    }

    if (reachJobs.length === 0) {
      content.innerHTML = `
        <div class="reach-empty">
          <div class="big">⭐</div>
          No reach jobs yet. Mark jobs as reach from the popup or Hiring.cafe modal.
        </div>
      `;
      return;
    }

    content.innerHTML = "";

    // Collect group IDs present in reach jobs (maintaining order by first appearance)
    const groupOrder: string[] = [];
    const jobsByGroup: Record<string, ReachJob[]> = { __ungrouped__: [] };

    reachJobs.forEach((job) => {
      if (job.groupId && reachGroups[job.groupId]) {
        if (!jobsByGroup[job.groupId]) {
          jobsByGroup[job.groupId] = [];
          groupOrder.push(job.groupId);
        }
        jobsByGroup[job.groupId].push(job);
      } else {
        jobsByGroup["__ungrouped__"].push(job);
      }
    });

    // Build group selector options
    const groupOptions = Object.entries(reachGroups)
      .map(([id, g]) => `<option value="${id}">${g.name}</option>`)
      .join("");
    const selectOptions = `<option value="">— ungrouped —</option>${groupOptions}`;

    // Render named groups
    groupOrder.forEach((groupId) => {
      const group = reachGroups[groupId];
      const jobs = jobsByGroup[groupId];
      const analysis = reachAnalyses[groupId];
      content.appendChild(buildGroupSection(groupId, group.name, jobs, selectOptions, analysis));
    });

    // Render ungrouped
    if (jobsByGroup["__ungrouped__"].length > 0) {
      const ungroupedSection = document.createElement("div");
      ungroupedSection.className = "reach-group";
      ungroupedSection.innerHTML = `
        <div class="reach-ungrouped-header">
          <span>Ungrouped (${jobsByGroup["__ungrouped__"].length})</span>
        </div>
      `;
      jobsByGroup["__ungrouped__"].forEach((job) => {
        ungroupedSection.appendChild(buildJobRow(job, selectOptions));
      });
      content.appendChild(ungroupedSection);
    }

    wireReachTabButtons();
  });
}

function buildGroupSection(
  groupId: string,
  groupName: string,
  jobs: ReachJob[],
  selectOptions: string,
  analysis?: ReachAnalysis,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "reach-group";
  section.setAttribute("data-group-id", groupId);

  section.innerHTML = `
    <div class="reach-group-header">
      <span class="reach-group-name">${groupName}</span>
      <span class="reach-group-count">${jobs.length} job${jobs.length !== 1 ? "s" : ""}</span>
      <button class="btn-analyze-group" data-group-id="${groupId}" data-group-name="${groupName}">
        ⚡ Analyze
      </button>
    </div>
  `;

  jobs.forEach((job) => {
    section.appendChild(buildJobRow(job, selectOptions));
  });

  if (analysis) {
    section.appendChild(buildAnalysisBlock(analysis));
  }

  return section;
}

function buildJobRow(job: ReachJob, selectOptions: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "reach-job-row";
  row.setAttribute("data-job-id", job.jobId);

  const siteLabel = job.site === "linkedin" ? "LinkedIn"
    : job.site === "indeed" ? "Indeed"
    : job.site === "hiring-cafe" ? "Hiring.cafe"
    : job.site;

  row.innerHTML = `
    <div class="reach-job-info">
      <div class="reach-job-title" title="${job.title} — ${job.company}">
        ${job.url
          ? `<a href="${job.url}" target="_blank" style="color:#e2e8f0;text-decoration:none;" onmouseover="this.style.color='#38bdf8'" onmouseout="this.style.color='#e2e8f0'">${job.title}</a>`
          : job.title}
      </div>
      <div class="reach-job-company">${job.company} · <span style="color:#475569">${siteLabel}</span></div>
    </div>
    <select class="reach-group-select" data-job-id="${job.jobId}">
      ${selectOptions.replace(`value="${job.groupId ?? ""}"`, `value="${job.groupId ?? ""}" selected`)}
    </select>
    <button class="btn-unreach" data-job-id="${job.jobId}" title="Remove reach tag">✕</button>
  `;

  return row;
}

function buildAnalysisBlock(analysis: ReachAnalysis): HTMLElement {
  const block = document.createElement("div");
  block.className = "reach-analysis";

  const skillsHtml = analysis.skill_themes.map((s) => `
    <li>
      <strong>${s.skill} <span class="reach-skill-freq">${s.frequency}×</span></strong>
      ${s.detail}
    </li>
  `).join("");

  const gapsHtml = analysis.experience_gaps.map((g) => `
    <li><strong>${g.gap}</strong>${g.detail}</li>
  `).join("");

  const stepsHtml = analysis.actionable_steps.map((a) => `
    <li><strong>${a.step}</strong>${a.detail}</li>
  `).join("");

  block.innerHTML = `
    <div class="reach-analysis-summary">${analysis.summary}</div>
    <div class="reach-analysis-grid">
      <div class="reach-analysis-section">
        <h4>Skill Themes</h4>
        <ul>${skillsHtml}</ul>
      </div>
      <div class="reach-analysis-section">
        <h4>Experience Gaps</h4>
        <ul>${gapsHtml}</ul>
      </div>
      <div class="reach-analysis-section">
        <h4>Actionable Steps</h4>
        <ul>${stepsHtml}</ul>
      </div>
    </div>
  `;

  return block;
}

function wireReachTabButtons(): void {
  const content = document.getElementById("reach-content");
  if (!content) return;

  // Group assignment dropdowns
  content.querySelectorAll<HTMLSelectElement>(".reach-group-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const jobId = sel.getAttribute("data-job-id")!;
      const job = reachJobs.find((j) => j.jobId === jobId);
      if (!job) return;
      const newGroupId = sel.value || undefined;
      job.groupId = newGroupId;
      saveReachJob(job);
      renderReachTab();
    });
  });

  // Unreach buttons
  content.querySelectorAll<HTMLButtonElement>(".btn-unreach").forEach((btn) => {
    btn.addEventListener("click", () => {
      const jobId = btn.getAttribute("data-job-id")!;
      chrome.storage.local.remove(`reach_jobid_${jobId}`, () => renderReachTab());
    });
  });

  // Analyze group buttons
  content.querySelectorAll<HTMLButtonElement>(".btn-analyze-group").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupId = btn.getAttribute("data-group-id")!;
      const groupName = btn.getAttribute("data-group-name")!;
      const jobs = reachJobs.filter((j) => j.groupId === groupId);

      btn.disabled = true;
      btn.textContent = "Analyzing…";

      // Replace any existing analysis block with a loading indicator
      const section = btn.closest(".reach-group")!;
      let existingAnalysis = section.querySelector(".reach-analysis");
      if (existingAnalysis) existingAnalysis.remove();

      const loadingEl = document.createElement("div");
      loadingEl.className = "reach-analysis";
      loadingEl.innerHTML = `
        <div class="reach-analysis-loading">
          <div class="reach-analysis-spinner"></div>
          Analyzing ${jobs.length} job${jobs.length !== 1 ? "s" : ""} in "${groupName}"…
        </div>
      `;
      section.appendChild(loadingEl);

      try {
        const token = await new Promise<string | null>((res) =>
          chrome.storage.local.get("auth_jwt", (d) => res((d.auth_jwt as string) ?? null)),
        );
        if (!token) throw new Error("Not signed in");

        const payload = {
          group_name: groupName,
          jobs: jobs.map((j) => ({
            job_id: j.jobId,
            title: j.title,
            company: j.company,
            url: j.url,
            site: j.site,
            skills: j.skills,
            description: j.description,
          })),
        };

        const r = await fetch(`${process.env.BACKEND_URL}/reach/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });

        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: "Unknown error" }));
          throw new Error(err.detail || `HTTP ${r.status}`);
        }

        const analysis: ReachAnalysis = await r.json();
        reachAnalyses[groupId] = analysis;

        loadingEl.remove();
        section.appendChild(buildAnalysisBlock(analysis));
      } catch (err) {
        loadingEl.innerHTML = `<div style="color:#f87171;font-size:12px;padding:8px 0;">Analysis failed: ${(err as Error).message}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = "⚡ Analyze";
      }
    });
  });
}

// Auto-group button
document.getElementById("btn-autogroup")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-autogroup") as HTMLButtonElement;
  if (reachJobs.length < 2) {
    alert("Add at least 2 reach jobs before auto-grouping.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Grouping…";

  try {
    const token = await new Promise<string | null>((res) =>
      chrome.storage.local.get("auth_jwt", (d) => res((d.auth_jwt as string) ?? null)),
    );
    if (!token) throw new Error("Not signed in");

    const payload = {
      jobs: reachJobs.map((j) => ({
        job_id: j.jobId,
        title: j.title,
        company: j.company,
        url: j.url,
        site: j.site,
        skills: j.skills,
      })),
    };

    const r = await fetch(`${process.env.BACKEND_URL}/reach/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(err.detail || `HTTP ${r.status}`);
    }

    const result: { groups: { job_id: string; group_name: string; group_id: string }[] } = await r.json();

    // Build/merge groups from result
    result.groups.forEach(({ job_id, group_name, group_id }) => {
      if (!reachGroups[group_id]) {
        reachGroups[group_id] = { name: group_name };
      }
      const job = reachJobs.find((j) => j.jobId === job_id);
      if (job) {
        job.groupId = group_id;
        saveReachJob(job);
      }
    });
    saveReachGroups();
    renderReachTab();
  } catch (err) {
    alert(`Auto-group failed: ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Auto-group";
  }
});

// New group button
document.getElementById("btn-new-group")?.addEventListener("click", () => {
  const name = promptNewGroup();
  if (!name) return;
  const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!id) return;
  reachGroups[id] = { name };
  saveReachGroups();
  renderReachTab();
});

// Load data
loadJobs();
