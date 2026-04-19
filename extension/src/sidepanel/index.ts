console.log("[JobScout] Side panel loaded");

import type { GreenhouseExtraction, GreenhouseQuestion } from "../content/extractors/greenhouse";

// ── State ──────────────────────────────────────────────────────────────────────

interface StoredScore {
  result: {
    fit_score: number;
    should_apply: boolean;
    one_line_verdict: string;
    direct_matches: Array<{ item: string; detail: string }>;
    transferable: Array<{ item: string; detail: string }>;
    gaps: Array<{ item: string; detail: string }>;
    red_flags: string[];
    green_flags: string[];
    salary_estimate?: {
      low: number;
      high: number;
      per: string;
      confidence?: string;
      assessment?: string | null;
    } | null;
    db_id?: number;
  };
  jobTitle: string;
  company: string;
  salary?: string;  // Listed salary string from the job posting
  dbId?: number;
  url?: string;
  timestamp: number;
}

interface ActiveJob {
  jobId: string;
  jobTitle: string;
  company: string;
  score: StoredScore;
}

let activeJob: ActiveJob | null = null;
let activeProfileId: number | null = null;
let activeProfileInstructions: string | null = null;
let ghExtraction: GreenhouseExtraction | null = null;

// ── DOM helpers ────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function scoreColor(score: number): { bg: string; color: string; border: string } {
  if (score >= 80) return { bg: "#052e16", color: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", color: "#facc15", border: "#78350f" };
  if (score >= 40) return { bg: "#1c0a00", color: "#fb923c", border: "#7c2d12" };
  return { bg: "#2d1515", color: "#f87171", border: "#7f1d1d" };
}

// ── Initialisation ─────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // 1. Get the current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;

  // 2. Load Greenhouse extraction from session storage
  if (tabId !== undefined) {
    const sessionData = await chrome.storage.session.get(`greenhouse_extraction_${tabId}`);
    ghExtraction = (sessionData[`greenhouse_extraction_${tabId}`] as GreenhouseExtraction) ?? null;
  }

  // 3. Load active profile id and fetch profile details (for app_assist_instructions)
  const localData = await chrome.storage.local.get(["active_profile_id", "active_profile_name", "auth_jwt"]);
  activeProfileId = (localData["active_profile_id"] as number) ?? null;
  const jwt = (localData["auth_jwt"] as string) ?? null;

  if (jwt) {
    try {
      const backendUrl = process.env.BACKEND_URL;
      const r = await fetch(`${backendUrl}/profiles/active`, {
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      });
      if (r.ok) {
        const profile: { id: number; name: string; app_assist_instructions: string | null } | null = await r.json();
        if (profile) {
          activeProfileId = profile.id;
          activeProfileInstructions = profile.app_assist_instructions;
        }
      }
    } catch (err) {
      console.warn("[JobScout SP] Failed to fetch active profile:", err);
    }
  }

  // 4. Match job from cached scores
  await matchJobFromCache();

  // 5. Render UI
  render();
}

async function matchJobFromCache(): Promise<void> {
  // Load all score_jobid_* keys
  const allData = await chrome.storage.local.get(null);
  const scoreKeys = Object.keys(allData).filter((k) => k.startsWith("score_jobid_"));

  if (scoreKeys.length === 0) return;

  const scores: Array<{ jobId: string; stored: StoredScore }> = scoreKeys
    .map((k) => ({ jobId: k.replace("score_jobid_", ""), stored: allData[k] as StoredScore }))
    .filter((s) => s.stored?.result && s.stored?.jobTitle)
    .sort((a, b) => b.stored.timestamp - a.stored.timestamp);

  if (scores.length === 0) return;

  if (ghExtraction) {
    const ghTitle = ghExtraction.jobTitle.toLowerCase();
    const ghCompany = ghExtraction.company.toLowerCase();

    // Try exact title+company match first
    const exact = scores.find(
      (s) =>
        s.stored.jobTitle.toLowerCase().includes(ghTitle.slice(0, 20)) &&
        s.stored.company.toLowerCase().includes(ghCompany.slice(0, 10)),
    );

    if (exact) {
      activeJob = { jobId: exact.jobId, jobTitle: exact.stored.jobTitle, company: exact.stored.company, score: exact.stored };
      return;
    }

    // Try company-only match → take most recent
    const companyMatch = scores.find(
      (s) => ghCompany.length > 2 && s.stored.company.toLowerCase().includes(ghCompany.slice(0, 10)),
    );
    if (companyMatch) {
      activeJob = { jobId: companyMatch.jobId, jobTitle: companyMatch.stored.jobTitle, company: companyMatch.stored.company, score: companyMatch.stored };
      return;
    }
  }

  // Fallback: most recent cached score
  const first = scores[0];
  activeJob = { jobId: first.jobId, jobTitle: first.stored.jobTitle, company: first.stored.company, score: first.stored };
}

// ── Render ─────────────────────────────────────────────────────────────────────

function render(): void {
  const content = $("main-content");
  const loading = $("loading-msg");
  if (loading) loading.remove();
  if (!content) return;

  // Header
  const headerTitle = $("header-title");
  const headerCompany = $("header-company");
  const scoreBadge = $<HTMLElement>("score-badge");

  if (activeJob) {
    if (headerTitle) headerTitle.textContent = activeJob.jobTitle || "Application Assistant";
    if (headerCompany) headerCompany.textContent = activeJob.company;
    if (scoreBadge) {
      const c = scoreColor(activeJob.score.result.fit_score);
      scoreBadge.textContent = String(activeJob.score.result.fit_score);
      scoreBadge.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 6px;
        font-size: 12px; font-weight: 700;
        background: ${c.bg}; color: ${c.color}; border: 1px solid ${c.border};
      `;
    }
  } else if (ghExtraction) {
    if (headerTitle) headerTitle.textContent = ghExtraction.jobTitle || "Application Assistant";
    if (headerCompany) headerCompany.textContent = ghExtraction.company;
  }

  // Context strip
  const contextHtml = renderContextStrip();
  content.insertAdjacentHTML("beforeend", contextHtml);
  wireContextStrip();

  // Salary section (only when there's salary data)
  const salaryHtml = renderSalarySection();
  if (salaryHtml) {
    content.insertAdjacentHTML("beforeend", salaryHtml);
    wireSalarySection();
  }

  // Instructions section
  content.insertAdjacentHTML("beforeend", renderInstructionsSection());
  wireInstructionsSection();

  // Questions section
  content.insertAdjacentHTML("beforeend", renderQuestionsSection());
  wireQuestionsSection();
}

function renderContextStrip(): string {
  if (!activeJob) {
    if (ghExtraction) {
      return `
        <div id="context-strip">
          <div style="font-size:12px;color:#64748b;">
            Found: <strong style="color:#e2e8f0">${ghExtraction.jobTitle}</strong> at ${ghExtraction.company}
          </div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">No cached score found. Analyze this job first via the extension popup.</div>
        </div>`;
    }
    return `<div id="context-strip"><div class="error-msg">No job context found. Open a job page first.</div></div>`;
  }

  const { result, jobTitle, company } = activeJob.score;
  const matchPills = (result.direct_matches ?? [])
    .slice(0, 4)
    .map((m) => `<span class="match-pill" title="${m.detail}">${m.item}</span>`)
    .join("");

  const confidence = ghExtraction
    ? `<span class="context-meta" id="context-change">Matched from cache — wrong job? Change ▾</span>`
    : `<span class="context-meta" id="context-change">Most recent cached job — change ▾</span>`;

  return `
    <div id="context-strip">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="font-size:12px;font-weight:600;color:#e2e8f0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${jobTitle} <span style="color:#64748b;font-weight:400;">@ ${company}</span>
        </div>
        <button class="btn-mark-applied" id="btn-mark-applied">Mark Applied</button>
      </div>
      ${matchPills ? `<div class="context-matches">${matchPills}</div>` : ""}
      ${confidence}
    </div>
    <div id="job-picker"></div>`;
}

function wireContextStrip(): void {
  const changeBtn = document.getElementById("context-change");
  const picker = document.getElementById("job-picker");

  // ── Mark Applied button ────────────────────────────────────────────────────
  const applyBtn = document.getElementById("btn-mark-applied") as HTMLButtonElement | null;
  if (applyBtn && activeJob) {
    const jobId = activeJob.jobId;

    // Restore already-applied state from storage (status_* is newer; applied_* is legacy)
    chrome.storage.local.get([`status_${jobId}`, `applied_${jobId}`], (data) => {
      if (data[`status_${jobId}`] === "applied" || data[`applied_${jobId}`]) {
        applyBtn.textContent = "✓ Applied";
        applyBtn.classList.add("done");
        applyBtn.disabled = true;
      }
    });

    applyBtn.addEventListener("click", () => {
      applyBtn.textContent = "✓ Applied";
      applyBtn.classList.add("done");
      applyBtn.disabled = true;

      const appliedDate = new Date().toISOString();
      const dbId = activeJob!.score.dbId ?? activeJob!.score.result.db_id;
      chrome.storage.local.set({ [`applied_date_${jobId}`]: appliedDate });
      chrome.runtime.sendMessage({
        type: "UPDATE_JOB_STATUS",
        jobId,
        dbId,
        status: "applied",
        appliedDate,
      });
    });
  }

  if (!changeBtn || !picker) return;

  changeBtn.addEventListener("click", async () => {
    if (picker.style.display === "block") {
      picker.style.display = "none";
      return;
    }

    const allData = await chrome.storage.local.get(null);
    const scores = Object.keys(allData)
      .filter((k) => k.startsWith("score_jobid_"))
      .map((k) => ({ jobId: k.replace("score_jobid_", ""), stored: allData[k] as StoredScore }))
      .filter((s) => s.stored?.jobTitle)
      .sort((a, b) => b.stored.timestamp - a.stored.timestamp);

    picker.innerHTML = scores
      .map(
        (s) => `
        <div class="picker-item" data-jobid="${s.jobId}">
          <div class="picker-item-title">${s.stored.jobTitle}</div>
          <div class="picker-item-company">${s.stored.company}</div>
        </div>`,
      )
      .join("");

    picker.style.display = "block";

    picker.querySelectorAll<HTMLElement>(".picker-item").forEach((item) => {
      item.addEventListener("click", () => {
        const jobId = item.dataset.jobid!;
        const stored = allData[`score_jobid_${jobId}`] as StoredScore;
        activeJob = { jobId, jobTitle: stored.jobTitle, company: stored.company, score: stored };
        picker.style.display = "none";

        // Re-render header + context strip
        const strip = document.getElementById("context-strip");
        const newStrip = document.createElement("div");
        newStrip.innerHTML = renderContextStrip();
        strip?.replaceWith(newStrip.firstElementChild!);
        picker.innerHTML = "";
        wireContextStrip();

        const headerTitle = $("header-title");
        const headerCompany = $("header-company");
        if (headerTitle) headerTitle.textContent = stored.jobTitle;
        if (headerCompany) headerCompany.textContent = stored.company;
      });
    });
  });
}

// ── Salary helpers ─────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function formatSalaryValue(amount: number, per: string): string {
  if (per === "hour") return `$${amount.toFixed(0)}/hr`;
  // anything else treated as year
  return `$${(amount / 1000).toFixed(0)}k/yr`;
}

function formatSalaryBound(amount: number, per: string): string {
  if (per === "hour") return `$${amount.toFixed(0)}`;
  return `$${(amount / 1000).toFixed(0)}k`;
}

function renderSalarySection(): string {
  if (!activeJob) return "";

  const est = activeJob.score.result.salary_estimate;
  const listed = activeJob.score.salary;

  if (!est && !listed) return "";

  let bodyHtml = "";

  if (est) {
    const { low, high, per, confidence } = est;
    const perLabel = per === "hour" ? "hr" : "yr";
    const lowBound = formatSalaryBound(low, per);
    const highBound = formatSalaryBound(high, per);
    const midValue = formatSalaryValue(Math.round((low + high) / 2), per);
    const confLabel = confidence ? `${confidence} confidence` : "";

    const listedRow = listed
      ? `<div class="salary-listed-row">Listed: ${listed}</div>`
      : "";

    bodyHtml = `
      ${listedRow}
      <div class="salary-header">
        <span class="salary-source">${listed ? "Claude estimate:" : "Market estimate:"}</span>
        <span class="salary-range-text">${lowBound} – ${highBound}/${perLabel}</span>
        ${confLabel ? `<span class="salary-confidence">${confLabel}</span>` : ""}
      </div>
      <div class="salary-slider-row">
        <span class="salary-bound">${lowBound}</span>
        <input type="range" class="salary-slider" id="salary-slider" min="0" max="100" value="50" style="--pct:50%">
        <span class="salary-bound">${highBound}</span>
      </div>
      <div class="salary-ask-row">
        Ask for: <strong id="salary-ask-value">${midValue}</strong>
        <span class="salary-percentile" id="salary-percentile">${ordinal(50)} percentile</span>
      </div>
    `;
  } else if (listed) {
    bodyHtml = `
      <div class="salary-header">
        <span class="salary-source">Listed salary:</span>
        <span class="salary-range-text">${listed}</span>
      </div>
    `;
  }

  return `
    <div class="section-card" id="section-salary">
      <div class="section-header open" id="hdr-salary">
        <div class="section-title">Salary</div>
        <span class="section-chevron open" id="chv-salary">▼</span>
      </div>
      <div class="section-body open" id="body-salary">
        ${bodyHtml}
      </div>
    </div>`;
}

function wireSalarySection(): void {
  const hdr = document.getElementById("hdr-salary");
  const body = document.getElementById("body-salary");
  const chv = document.getElementById("chv-salary");

  hdr?.addEventListener("click", () => {
    body?.classList.toggle("open");
    hdr.classList.toggle("open");
    chv?.classList.toggle("open");
  });

  const slider = document.getElementById("salary-slider") as HTMLInputElement | null;
  const askValue = document.getElementById("salary-ask-value");
  const percentileLabel = document.getElementById("salary-percentile");

  if (!slider || !activeJob?.score.result.salary_estimate) return;

  const { low, high, per } = activeJob.score.result.salary_estimate;

  function updateAsk(pct: number): void {
    const value = Math.round(low + (pct / 100) * (high - low));
    if (askValue) askValue.textContent = formatSalaryValue(value, per);
    if (percentileLabel) percentileLabel.textContent = `${ordinal(pct)} percentile`;
    // Update track fill
    slider!.style.setProperty("--pct", `${pct}%`);
  }

  slider.addEventListener("input", () => updateAsk(Number(slider.value)));
}

function renderInstructionsSection(): string {
  return `
    <div class="section-card" id="section-instructions">
      <div class="section-header open" id="hdr-instructions">
        <div class="section-title">Assistant Instructions</div>
        <span class="section-chevron open" id="chv-instructions">▼</span>
      </div>
      <div class="section-body open" id="body-instructions">
        <textarea id="instructions-textarea" rows="3" placeholder="e.g. Keep answers under 3 sentences. Focus on measurable outcomes."></textarea>
        <div style="font-size:10px;color:#334155;margin-top:4px;">Edits are saved locally and synced to your profile.</div>
      </div>
    </div>`;
}

function wireInstructionsSection(): void {
  const hdr = document.getElementById("hdr-instructions");
  const body = document.getElementById("body-instructions");
  const chv = document.getElementById("chv-instructions");
  const ta = document.getElementById("instructions-textarea") as HTMLTextAreaElement | null;

  // Toggle collapse
  hdr?.addEventListener("click", () => {
    body?.classList.toggle("open");
    hdr.classList.toggle("open");
    chv?.classList.toggle("open");
  });

  // Load saved instructions: local override first, then profile's app_assist_instructions
  chrome.storage.local.get("sidepanel_instructions", (data) => {
    if (!ta) return;
    const localOverride = data["sidepanel_instructions"] as string | undefined;
    if (localOverride !== undefined && localOverride !== "") {
      ta.value = localOverride;
    } else if (activeProfileInstructions) {
      ta.value = activeProfileInstructions;
    }
  });

  // Save on blur
  ta?.addEventListener("blur", () => {
    const val = ta.value.trim();
    chrome.storage.local.set({ sidepanel_instructions: val });

    // Sync to profile if we know the profile id
    if (activeProfileId) {
      chrome.runtime.sendMessage({
        type: "UPDATE_PROFILE_INSTRUCTIONS",
        profileId: activeProfileId,
        appAssistInstructions: val,
      });
    }
  });
}

function renderQuestionsSection(): string {
  const questions = ghExtraction?.questions ?? [];

  const qBlocks = questions
    .map((q, i) => renderQABlock(i, q.label))
    .join("");

  const emptyState = questions.length === 0
    ? `<div class="qa-empty-state">No questions auto-detected. Add them manually below.</div>`
    : "";

  return `
    <div class="section-card" id="section-questions">
      <div class="section-header open" id="hdr-questions">
        <div class="section-title">Application Questions</div>
        <span class="section-chevron open" id="chv-questions">▼</span>
      </div>
      <div class="section-body open" id="body-questions">
        <div class="qa-list" id="qa-list">
          ${emptyState}
          ${qBlocks}
        </div>
        <button class="btn-add-question" id="btn-add-question">+ Add Question</button>
      </div>
    </div>`;
}

let qaCounter = 0;

function renderQABlock(index: number, prefillQuestion = ""): string {
  const id = `qa-${index}-${Date.now()}`;
  qaCounter = Math.max(qaCounter, index + 1);
  return `
    <div class="qa-block" id="block-${id}">
      <div class="qa-block-header">
        <textarea class="qa-question-input" id="q-${id}" rows="2" placeholder="Paste question here…">${prefillQuestion}</textarea>
        <div class="qa-actions">
          <button class="btn-generate-answer" data-blockid="${id}">✦ Generate</button>
          <button class="btn-remove-qa" data-blockid="${id}" title="Remove">×</button>
        </div>
      </div>
      <div class="qa-answer-wrap" id="answer-wrap-${id}" style="display:none">
        <div class="qa-answer-label">
          Answer
          <button class="btn-copy" data-blockid="${id}">Copy</button>
        </div>
        <textarea id="a-${id}" rows="4" placeholder="Generated answer will appear here…"></textarea>
      </div>
    </div>`;
}

function wireQuestionsSection(): void {
  const hdr = document.getElementById("hdr-questions");
  const body = document.getElementById("body-questions");
  const chv = document.getElementById("chv-questions");

  hdr?.addEventListener("click", () => {
    body?.classList.toggle("open");
    hdr.classList.toggle("open");
    chv?.classList.toggle("open");
  });

  document.getElementById("btn-add-question")?.addEventListener("click", () => {
    const list = document.getElementById("qa-list");
    if (!list) return;
    // Remove empty state placeholder
    list.querySelector(".qa-empty-state")?.remove();
    const html = renderQABlock(qaCounter++);
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const block = tmp.firstElementChild!;
    list.appendChild(block);
    wireQABlock(block as HTMLElement);
    (block.querySelector(".qa-question-input") as HTMLTextAreaElement | null)?.focus();
  });

  // Wire existing blocks (auto-detected questions)
  document.querySelectorAll<HTMLElement>(".qa-block").forEach((block) => {
    wireQABlock(block);
  });
}

function wireQABlock(block: HTMLElement): void {
  const blockId = block.id.replace("block-", "");

  // Remove button
  block.querySelector<HTMLElement>(`[data-blockid="${blockId}"].btn-remove-qa`)?.addEventListener("click", () => {
    block.remove();
  });

  // Generate button
  block.querySelector<HTMLElement>(`[data-blockid="${blockId}"].btn-generate-answer`)?.addEventListener("click", async () => {
    const questionEl = block.querySelector<HTMLTextAreaElement>(`#q-${blockId}`);
    const question = questionEl?.value?.trim();
    if (!question) {
      questionEl?.focus();
      return;
    }

    const generateBtn = block.querySelector<HTMLButtonElement>(`[data-blockid="${blockId}"].btn-generate-answer`)!;
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class="spinner"></span>Generating…`;

    try {
      const answer = await generateAnswer(question);
      const answerEl = block.querySelector<HTMLTextAreaElement>(`#a-${blockId}`);
      const answerWrap = block.querySelector<HTMLElement>(`#answer-wrap-${blockId}`);
      if (answerEl) answerEl.value = answer;
      if (answerWrap) answerWrap.style.display = "flex";
      answerWrap?.style.setProperty("flex-direction", "column");
      answerWrap?.style.setProperty("gap", "3px");
    } catch (err) {
      const answerWrap = block.querySelector<HTMLElement>(`#answer-wrap-${blockId}`);
      if (answerWrap) {
        answerWrap.style.display = "block";
        answerWrap.innerHTML = `<div class="error-msg">${(err as Error).message}</div>`;
      }
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "✦ Generate";
    }
  });

  // Copy button
  block.querySelector<HTMLElement>(`[data-blockid="${blockId}"].btn-copy`)?.addEventListener("click", async (e) => {
    const answerEl = block.querySelector<HTMLTextAreaElement>(`#a-${blockId}`);
    if (!answerEl?.value) return;
    await navigator.clipboard.writeText(answerEl.value);
    const btn = e.currentTarget as HTMLElement;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1500);
  });
}

async function generateAnswer(question: string): Promise<string> {
  if (!activeJob) throw new Error("No job context loaded.");

  const { result, jobTitle, company } = activeJob.score;
  const dbId = result.db_id ?? activeJob.score.dbId;

  // Fetch job description from backend if we have a dbId
  let jobDescription = "";
  if (dbId) {
    const scoreResp = await new Promise<{ success: boolean; data?: { job_description?: string } }>((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_SCORE_FROM_BACKEND", jobId: dbId }, resolve);
    });
    if (scoreResp.success && scoreResp.data?.job_description) {
      jobDescription = scoreResp.data.job_description;
    }
  }

  // Get instructions
  const instrData = await chrome.storage.local.get("sidepanel_instructions");
  const instructions = (instrData["sidepanel_instructions"] as string) ?? "";

  const payload = {
    job_title: jobTitle,
    company,
    job_description: jobDescription,
    question,
    direct_matches: result.direct_matches ?? [],
    transferable: result.transferable ?? [],
    gaps: result.gaps ?? [],
    instructions,
  };

  const resp = await new Promise<{ success: boolean; data?: { answer: string }; error?: string }>((resolve) => {
    chrome.runtime.sendMessage({ type: "GENERATE_APP_ANSWER", payload }, resolve);
  });

  if (!resp.success) throw new Error(resp.error ?? "Generation failed");
  return resp.data?.answer ?? "";
}

// ── Boot ───────────────────────────────────────────────────────────────────────

init().catch((err) => {
  console.error("[JobScout] Side panel init failed:", err);
  const content = $("main-content");
  if (content) {
    content.innerHTML = `<div class="error-msg">Failed to load: ${err.message}</div>`;
  }
});

export {};
