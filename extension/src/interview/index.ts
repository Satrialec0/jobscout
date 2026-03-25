export {};
console.log("[JobScout Interview] Loaded");

// ── Types ──────────────────────────────────────────────────────────────────

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
  url?: string;
}

interface GapStrategy {
  gap: string;
  strategy: string;
}

interface QuestionWithTalkingPoint {
  question: string;
  talking_points: string[];
}

interface AIPrepBrief {
  questions: QuestionWithTalkingPoint[];
  research_prompts: string[];
  gap_strategies: GapStrategy[];
  questions_to_ask: string[];
  generatedAt: number;
}

interface CompanyInfo {
  employees?: string;
  website?: string;
  headquarters?: string;
  industry?: string;
  fetchedAt: number;
}

interface InterviewPrepData {
  aiBrief?: AIPrepBrief;
  companyInfo?: CompanyInfo;
  companyNotes: string;
  interviewDate?: string;
  questionsAsked: string[];
  highlights: string[];
  lowlights: string[];
  impression?: "positive" | "neutral" | "negative";
  followUpNotes: string;
  updatedAt: number;
}

// ── State ──────────────────────────────────────────────────────────────────

let jobId = "";
let storedScore: StoredScore | null = null;
let prepData: InterviewPrepData = {
  companyNotes: "",
  questionsAsked: [],
  highlights: [],
  lowlights: [],
  followUpNotes: "",
  updatedAt: Date.now(),
};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function getScoreStyle(score: number): { bg: string; text: string; border: string } {
  if (score >= 80) return { bg: "#052e16", text: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", text: "#facc15", border: "#854d0e" };
  if (score >= 40) return { bg: "#1c0a00", text: "#fb923c", border: "#9a3412" };
  return { bg: "#2d1515", text: "#f87171", border: "#7f1d1d" };
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  applied:      { label: "Applied",      bg: "#0c1a3a", color: "#38bdf8", border: "#1e3a5f" },
  phone_screen: { label: "Phone Screen", bg: "#1c1400", color: "#facc15", border: "#78350f" },
  interviewed:  { label: "Interviewed",  bg: "#1a0a2e", color: "#a78bfa", border: "#4c1d95" },
  offer:        { label: "Offer",        bg: "#052e16", color: "#4ade80", border: "#166534" },
  rejected:     { label: "Rejected",     bg: "#2d1515", color: "#f87171", border: "#7f1d1d" },
};

function flashSaved(): void {
  const el = document.getElementById("save-indicator");
  if (!el) return;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 1500);
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 600);
}

function persist(): void {
  prepData.updatedAt = Date.now();
  chrome.storage.local.set({ [`interview_prep_${jobId}`]: prepData }, flashSaved);
}

// ── Collapsible sections ───────────────────────────────────────────────────

function setupCollapsible(headerId: string, bodyId: string, chevronId: string): void {
  const hdr = document.getElementById(headerId);
  const body = document.getElementById(bodyId);
  const chv = document.getElementById(chevronId);
  if (!hdr || !body || !chv) return;

  hdr.addEventListener("click", () => {
    const isOpen = body.classList.toggle("open");
    chv.classList.toggle("open", isOpen);
    hdr.classList.toggle("open", isOpen);
  });
}

// ── Dynamic list rendering ─────────────────────────────────────────────────

type ListKey = "questionsAsked" | "highlights" | "lowlights";

function renderList(
  containerId: string,
  key: ListKey,
  placeholder: string
): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const items: string[] = prepData[key] as string[];
  items.forEach((val, idx) => {
    const div = document.createElement("div");
    div.className = "list-item";

    const input = document.createElement("input");
    input.type = "text";
    input.value = val;
    input.placeholder = placeholder;
    input.addEventListener("input", () => {
      (prepData[key] as string[])[idx] = input.value;
      scheduleSave();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      (prepData[key] as string[]).splice(idx, 1);
      renderList(containerId, key, placeholder);
      scheduleSave();
    });

    div.appendChild(input);
    div.appendChild(removeBtn);
    container.appendChild(div);
  });
}

function setupAddButton(
  btnId: string,
  containerId: string,
  key: ListKey,
  placeholder: string
): void {
  document.getElementById(btnId)?.addEventListener("click", () => {
    (prepData[key] as string[]).push("");
    renderList(containerId, key, placeholder);
    scheduleSave();
    // Focus the new input
    const inputs = document.querySelectorAll<HTMLInputElement>(`#${containerId} input`);
    inputs[inputs.length - 1]?.focus();
  });
}

// ── Render header ──────────────────────────────────────────────────────────

function renderHeader(score: StoredScore, status: string | null): void {
  const titleEl = document.getElementById("header-title");
  const companyEl = document.getElementById("header-company");
  const scorePill = document.getElementById("score-pill");
  const statusBadge = document.getElementById("status-badge");

  if (titleEl) titleEl.textContent = score.jobTitle;
  if (companyEl) companyEl.textContent = score.company;

  if (scorePill) {
    const { bg, text, border } = getScoreStyle(score.result.fit_score);
    scorePill.textContent = String(score.result.fit_score);
    scorePill.style.background = bg;
    scorePill.style.color = text;
    scorePill.style.border = `1px solid ${border}`;
  }

  if (statusBadge && status) {
    const cfg = STATUS_CONFIG[status];
    if (cfg) {
      statusBadge.textContent = cfg.label;
      statusBadge.style.background = cfg.bg;
      statusBadge.style.color = cfg.color;
      statusBadge.style.border = `1px solid ${cfg.border}`;
    }
  }

  document.title = `Interview Prep — ${score.jobTitle} @ ${score.company}`;
}

// ── Render all form fields from prepData ───────────────────────────────────

function renderAll(): void {
  // Company details
  renderCompanyDetails(prepData.companyInfo);

  // Company notes
  const notesEl = document.getElementById("company-notes") as HTMLTextAreaElement | null;
  if (notesEl) notesEl.value = prepData.companyNotes;

  // Follow-up notes
  const followupEl = document.getElementById("followup-notes") as HTMLTextAreaElement | null;
  if (followupEl) followupEl.value = prepData.followUpNotes;

  // Interview date
  const dateEl = document.getElementById("interview-date") as HTMLInputElement | null;
  if (dateEl && prepData.interviewDate) dateEl.value = prepData.interviewDate;

  // Impression
  renderImpression();

  // Lists
  renderList("list-qasked", "questionsAsked", "Question they asked...");
  renderList("list-highlights", "highlights", "What went well...");
  renderList("list-lowlights", "lowlights", "What could have gone better...");

  // AI brief
  if (prepData.aiBrief) {
    renderAIBrief(prepData.aiBrief);
  }
}

// ── Impression selector ────────────────────────────────────────────────────

function renderImpression(): void {
  document.querySelectorAll<HTMLElement>(".impression-opt").forEach((el) => {
    el.className = "impression-opt";
    if (el.getAttribute("data-value") === prepData.impression) {
      el.classList.add(`selected-${prepData.impression}`);
    }
  });
}

function setupImpression(): void {
  document.querySelectorAll<HTMLElement>(".impression-opt").forEach((el) => {
    el.addEventListener("click", () => {
      const val = el.getAttribute("data-value") as "positive" | "neutral" | "negative";
      prepData.impression = prepData.impression === val ? undefined : val;
      renderImpression();
      scheduleSave();
    });
  });
}

// ── AI Brief ───────────────────────────────────────────────────────────────

function renderCompanyDetails(info?: CompanyInfo): void {
  const grid = document.getElementById("company-details-grid");
  const btn = document.getElementById("btn-lookup") as HTMLButtonElement | null;
  if (!grid) return;

  const fields: Array<{ label: string; value?: string; isUrl?: boolean }> = [
    { label: "Industry",     value: info?.industry },
    { label: "Size",         value: info?.employees },
    { label: "HQ",           value: info?.headquarters },
    { label: "Website",      value: info?.website, isUrl: true },
  ];

  grid.innerHTML = fields.map(({ label, value, isUrl }) => {
    let display: string;
    if (!value) {
      display = `<span class="company-detail-value empty">—</span>`;
    } else if (isUrl) {
      const href = value.startsWith("http") ? value : `https://${value}`;
      const display_text = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
      display = `<span class="company-detail-value"><a href="${escapeHtml(href)}" target="_blank">${escapeHtml(display_text)}</a></span>`;
    } else {
      display = `<span class="company-detail-value">${escapeHtml(value)}</span>`;
    }
    return `
      <div class="company-detail-item">
        <div class="company-detail-label">${label}</div>
        ${display}
      </div>`;
  }).join("");

  if (btn) btn.textContent = info ? "↺ Refresh" : "Look up";
}

async function lookupCompanyInfo(): Promise<void> {
  if (!storedScore) return;
  const btn = document.getElementById("btn-lookup") as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner"></span>`;

  // Try to get the job description to improve extraction accuracy
  const scoreJobId = jobId.startsWith("hc_") ? jobId.replace("hc_", "") : jobId;
  let jobDescription = "";
  const scoreResp = await sendMessage<{ job_description?: string }>({
    type: "GET_SCORE_FROM_BACKEND",
    jobId: scoreJobId,
  });
  if (scoreResp.success && scoreResp.data?.job_description) {
    jobDescription = scoreResp.data.job_description;
  }

  const resp = await sendMessage<CompanyInfo>({
    type: "GET_COMPANY_INFO",
    payload: { company: storedScore.company, job_description: jobDescription },
  });

  btn.disabled = false;

  if (resp.success && resp.data) {
    prepData.companyInfo = { ...resp.data, fetchedAt: Date.now() };
    scheduleSave();
    renderCompanyDetails(prepData.companyInfo);
    // Expand the body so results are visible
    const body = document.getElementById("body-company-details");
    const chv = document.getElementById("chv-company-details");
    const hdr = document.getElementById("hdr-company-details");
    if (body && !body.classList.contains("open")) {
      body.classList.add("open");
      chv?.classList.add("open");
      hdr?.classList.add("open");
    }
  } else {
    btn.textContent = "Retry";
  }
}

function renderAIBrief(brief: AIPrepBrief): void {
  const container = document.getElementById("ai-brief-content");
  const meta = document.getElementById("ai-brief-meta");
  if (!container) return;

  if (meta) {
    const d = new Date(brief.generatedAt);
    meta.textContent = `Generated ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  container.innerHTML = `
    <div class="ai-brief-content">
      ${brief.questions.length ? `
        <div>
          <div class="ai-section-label">Likely Questions &amp; Talking Points</div>
          <div class="question-list">
            ${brief.questions.map((q, i) => `
              <div class="question-item">
                <div class="question-number">${i + 1}</div>
                <div class="question-body">
                  <div class="question-text">${escapeHtml(q.question)}</div>
                  <ul class="talking-points">
                    ${q.talking_points.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
                  </ul>
                </div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}

      ${brief.research_prompts.length ? `
        <div>
          <div class="ai-section-label">Research Before the Interview</div>
          <ul class="ai-list">
            ${brief.research_prompts.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
          </ul>
        </div>` : ""}

      ${brief.gap_strategies.length ? `
        <div>
          <div class="ai-section-label">Gap Strategies</div>
          ${brief.gap_strategies.map((g) => `
            <div class="gap-strategy-item">
              <div class="gap-strategy-gap">⚠ ${escapeHtml(g.gap)}</div>
              <div class="gap-strategy-text">${escapeHtml(g.strategy)}</div>
            </div>
          `).join("")}
        </div>` : ""}

      ${brief.questions_to_ask?.length ? `
        <div>
          <div class="ai-section-label">Questions to Ask Them</div>
          <ul class="ai-list">
            ${brief.questions_to_ask.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}
          </ul>
        </div>` : ""}
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendMessage<T>(msg: object): Promise<{ success: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response ?? { success: false, error: "No response" });
      }
    });
  });
}

async function generateBrief(): Promise<void> {
  if (!storedScore) return;

  const btn = document.getElementById("btn-generate") as HTMLButtonElement | null;
  const container = document.getElementById("ai-brief-content");
  const meta = document.getElementById("ai-brief-meta");
  if (!btn || !container) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner"></span>Generating...`;
  container.innerHTML = "";
  if (meta) meta.textContent = "";

  try {
    // Fetch job description via background service worker
    // LinkedIn: numeric jobId; Indeed: alphanum; HC: hc_xxx → strip prefix for URL lookup
    const scoreJobId = jobId.startsWith("hc_") ? jobId.replace("hc_", "") : jobId;
    let jobDescription = "";

    const scoreResp = await sendMessage<{ job_description?: string }>({
      type: "GET_SCORE_FROM_BACKEND",
      jobId: scoreJobId,
    });
    if (scoreResp.success && scoreResp.data?.job_description) {
      jobDescription = scoreResp.data.job_description;
    }
    // Proceed even without job_description — backend handles it gracefully

    // Generate prep brief via background service worker
    const prepResp = await sendMessage<AIPrepBrief>({
      type: "GENERATE_INTERVIEW_PREP",
      payload: {
        job_title: storedScore.jobTitle,
        company: storedScore.company,
        job_description: jobDescription,
        direct_matches: storedScore.result.direct_matches ?? [],
        transferable: storedScore.result.transferable ?? [],
        gaps: storedScore.result.gaps ?? [],
        green_flags: storedScore.result.green_flags ?? [],
        red_flags: storedScore.result.red_flags ?? [],
      },
    });

    if (!prepResp.success || !prepResp.data) {
      throw new Error(prepResp.error ?? "Backend returned an error. Make sure the backend is running.");
    }

    const aiBrief: AIPrepBrief = { ...prepResp.data, generatedAt: Date.now() };
    prepData.aiBrief = aiBrief;
    scheduleSave();
    renderAIBrief(aiBrief);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    container.innerHTML = `<div class="error-msg">Error: ${escapeHtml(msg)}</div>`;
    if (meta) meta.textContent = "";
  } finally {
    btn.disabled = false;
    btn.innerHTML = "↺ Regenerate Brief";
  }
}

// ── Tab switching ──────────────────────────────────────────────────────────

function setupTabs(): void {
  document.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab")!;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${tab}`)?.classList.add("active");
    });
  });
}

// ── Wire up form change events ─────────────────────────────────────────────

function setupFormEvents(): void {
  document.getElementById("company-notes")?.addEventListener("input", (e) => {
    prepData.companyNotes = (e.target as HTMLTextAreaElement).value;
    scheduleSave();
  });

  document.getElementById("followup-notes")?.addEventListener("input", (e) => {
    prepData.followUpNotes = (e.target as HTMLTextAreaElement).value;
    scheduleSave();
  });

  document.getElementById("interview-date")?.addEventListener("change", (e) => {
    prepData.interviewDate = (e.target as HTMLInputElement).value;
    scheduleSave();
  });

  document.getElementById("btn-generate")?.addEventListener("click", generateBrief);
  document.getElementById("btn-lookup")?.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent collapsible toggle
    lookupCompanyInfo();
  });
  document.getElementById("btn-back")?.addEventListener("click", () => window.close());

  setupAddButton("add-qasked",    "list-qasked",    "questionsAsked", "Question they asked...");
  setupAddButton("add-highlights","list-highlights", "highlights",     "What went well...");
  setupAddButton("add-lowlights", "list-lowlights", "lowlights",      "What could have gone better...");

  setupImpression();
}

// ── Collapsible setup ──────────────────────────────────────────────────────

function setupCollapsibles(): void {
  const sections = [
    ["hdr-company-details", "body-company-details", "chv-company-details"],
    ["hdr-ai",        "body-ai",        "chv-ai"],
    ["hdr-notes",     "body-notes",     "chv-notes"],
    ["hdr-meta",      "body-meta",      "chv-meta"],
    ["hdr-qasked",    "body-qasked",    "chv-qasked"],
    ["hdr-highlights","body-highlights","chv-highlights"],
    ["hdr-lowlights", "body-lowlights", "chv-lowlights"],
    ["hdr-followup",  "body-followup",  "chv-followup"],
  ];
  sections.forEach(([h, b, c]) => setupCollapsible(h, b, c));
}

// ── Init ───────────────────────────────────────────────────────────────────

function init(): void {
  jobId = location.hash.replace("#", "").trim();
  if (!jobId) {
    document.getElementById("header-title")!.textContent = "No job selected";
    return;
  }

  setupTabs();
  setupCollapsibles();
  setupFormEvents();

  const storageKeys = [`score_jobid_${jobId}`, `status_${jobId}`, `interview_prep_${jobId}`];

  chrome.storage.local.get(storageKeys, (data) => {
    storedScore = (data[`score_jobid_${jobId}`] as StoredScore) ?? null;
    const status = (data[`status_${jobId}`] as string) ?? null;
    const saved = data[`interview_prep_${jobId}`] as InterviewPrepData | undefined;

    if (storedScore) {
      renderHeader(storedScore, status);
    }

    if (saved) {
      prepData = {
        companyNotes: saved.companyNotes ?? "",
        questionsAsked: saved.questionsAsked ?? [],
        highlights: saved.highlights ?? [],
        lowlights: saved.lowlights ?? [],
        followUpNotes: saved.followUpNotes ?? "",
        updatedAt: saved.updatedAt ?? Date.now(),
        aiBrief: saved.aiBrief,
        companyInfo: saved.companyInfo,
        interviewDate: saved.interviewDate,
        impression: saved.impression,
      };
    }

    renderAll();
  });
}

init();
