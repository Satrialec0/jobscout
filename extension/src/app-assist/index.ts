export {};
console.log("[JobScout AppAssist] Loaded");

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
  db_id?: number;
}

interface StoredScore {
  result: AnalyzeResponse;
  jobTitle: string;
  company: string;
  timestamp: number;
  url?: string;
  dbId?: number;
}

interface QAItem {
  question: string;
  answer: string;
}

interface CoverLetterVersion {
  text: string;
  length: "short" | "medium" | "long";
  generatedAt: number;
}

interface AppAssistLocalData {
  coverLetters: CoverLetterVersion[];
  salaryAsk: number | null;
  questions: QAItem[];
  updatedAt: number;
}

// ── State ──────────────────────────────────────────────────────────────────

let jobId = "";
let storedScore: StoredScore | null = null;
let dbId: number | null = null;
let salaryEstimate: SalaryEstimate | null = null;
let assistData: AppAssistLocalData = {
  coverLetters: [],
  salaryAsk: null,
  questions: [],
  updatedAt: Date.now(),
};
let activeCoverIndex = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let currentStatus: string | null = null;

const LENGTH_LABELS: Record<string, string> = {
  "0": "Short (~250 words)",
  "1": "Medium (~400 words)",
  "2": "Long (~600 words)",
};

const LENGTH_VALUES: Record<string, "short" | "medium" | "long"> = {
  "0": "short",
  "1": "medium",
  "2": "long",
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string; border: string }> = {
  applied:      { label: "Applied",      bg: "#0c1a3a", color: "#38bdf8", border: "#1e3a5f" },
  phone_screen: { label: "Phone Screen", bg: "#1c1400", color: "#facc15", border: "#78350f" },
  interviewed:  { label: "Interviewed",  bg: "#1a0a2e", color: "#a78bfa", border: "#4c1d95" },
  offer:        { label: "Offer",        bg: "#052e16", color: "#4ade80", border: "#166534" },
  rejected:     { label: "Rejected",     bg: "#2d1515", color: "#f87171", border: "#7f1d1d" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getScoreStyle(score: number): { bg: string; text: string; border: string } {
  if (score >= 80) return { bg: "#052e16", text: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", text: "#facc15", border: "#854d0e" };
  if (score >= 40) return { bg: "#1c0a00", text: "#fb923c", border: "#9a3412" };
  return { bg: "#2d1515", text: "#f87171", border: "#7f1d1d" };
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
  assistData.updatedAt = Date.now();
  chrome.storage.local.set({ [`app_assist_${jobId}`]: assistData }, flashSaved);

  // Sync active version to DB if we have a dbId
  if (dbId) {
    const active = assistData.coverLetters[activeCoverIndex];
    sendMessage({
      type: "SAVE_APP_ASSIST",
      dbId,
      payload: {
        cover_letter: active?.text || null,
        cover_letter_length: active?.length || null,
        salary_ask: assistData.salaryAsk,
        questions: assistData.questions,
      },
    }).catch(() => {});
  }
}

// ── Collapsible sections ───────────────────────────────────────────────────

function setupCollapsible(headerId: string, bodyId: string, chevronId: string): void {
  const hdr = document.getElementById(headerId);
  const body = document.getElementById(bodyId);
  const chv = document.getElementById(chevronId);
  if (!hdr || !body || !chv) return;

  hdr.addEventListener("click", (e) => {
    // Don't collapse if clicking a button inside the header
    if ((e.target as HTMLElement).closest("button, input")) return;
    const isOpen = body.classList.toggle("open");
    chv.classList.toggle("open", isOpen);
    hdr.classList.toggle("open", isOpen);
  });
}

// ── Header rendering ───────────────────────────────────────────────────────

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

  document.title = `Application — ${score.jobTitle} @ ${score.company}`;
}

// ── Cover letter ───────────────────────────────────────────────────────────

function getSelectedLength(): "short" | "medium" | "long" {
  const slider = document.getElementById("cover-length-slider") as HTMLInputElement | null;
  return LENGTH_VALUES[slider?.value ?? "1"] ?? "medium";
}

function updateLengthLabel(): void {
  const slider = document.getElementById("cover-length-slider") as HTMLInputElement | null;
  const label = document.getElementById("cover-length-label");
  if (slider && label) {
    label.textContent = LENGTH_LABELS[slider.value] ?? "Medium (~400 words)";
  }
}

function renderCoverTabs(): void {
  const tabBar = document.getElementById("cover-tab-bar");
  const textarea = document.getElementById("cover-letter-text") as HTMLTextAreaElement | null;
  const copyBtn = document.getElementById("btn-copy-cover") as HTMLButtonElement | null;
  if (!tabBar) return;

  tabBar.innerHTML = "";

  if (assistData.coverLetters.length === 0) {
    tabBar.style.display = "none";
    if (copyBtn) copyBtn.disabled = true;
    return;
  }

  tabBar.style.display = "flex";
  if (copyBtn) copyBtn.disabled = false;

  // Clamp active index
  if (activeCoverIndex >= assistData.coverLetters.length) {
    activeCoverIndex = assistData.coverLetters.length - 1;
  }

  assistData.coverLetters.forEach((v, i) => {
    const tab = document.createElement("div");
    tab.className = "cover-tab" + (i === activeCoverIndex ? " active" : "");

    const d = new Date(v.generatedAt);
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const lengthLabel = v.length.charAt(0).toUpperCase() + v.length.slice(1);

    const labelSpan = document.createElement("span");
    labelSpan.className = "cover-tab-label";
    labelSpan.textContent = `${lengthLabel} · ${dateStr}`;

    const closeSpan = document.createElement("span");
    closeSpan.className = "cover-tab-close";
    closeSpan.title = "Remove";
    closeSpan.textContent = "✕";

    tab.appendChild(labelSpan);
    tab.appendChild(closeSpan);

    tab.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("cover-tab-close")) return;
      activeCoverIndex = i;
      renderCoverTabs();
      if (textarea) textarea.value = assistData.coverLetters[i].text;
    });

    closeSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      assistData.coverLetters.splice(i, 1);
      if (activeCoverIndex >= assistData.coverLetters.length) {
        activeCoverIndex = Math.max(0, assistData.coverLetters.length - 1);
      }
      renderCoverTabs();
      if (textarea) {
        textarea.value = assistData.coverLetters[activeCoverIndex]?.text ?? "";
      }
      scheduleSave();
    });

    tabBar.appendChild(tab);
  });

  // Load active version into textarea
  if (textarea && assistData.coverLetters[activeCoverIndex]) {
    textarea.value = assistData.coverLetters[activeCoverIndex].text;
  }
}

function restoreCoverLetter(): void {
  renderCoverTabs();
  // Restore slider to match the most recently active version
  const active = assistData.coverLetters[activeCoverIndex];
  if (active) {
    const sliderVal = Object.entries(LENGTH_VALUES).find(([, v]) => v === active.length)?.[0] ?? "1";
    const slider = document.getElementById("cover-length-slider") as HTMLInputElement | null;
    if (slider) {
      slider.value = sliderVal;
      updateLengthLabel();
    }
  }
}

async function generateCoverLetter(): Promise<void> {
  if (!storedScore) return;

  const btn = document.getElementById("btn-generate-cover") as HTMLButtonElement | null;
  const textarea = document.getElementById("cover-letter-text") as HTMLTextAreaElement | null;
  if (!btn || !textarea) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner"></span>Generating...`;

  try {
    const scoreJobId = jobId.startsWith("hc_") ? jobId.replace("hc_", "") : jobId;
    let jobDescription = "";
    const scoreResp = await sendMessage<{ job_description?: string }>({
      type: "GET_SCORE_FROM_BACKEND",
      jobId: scoreJobId,
    });
    if (scoreResp.success && scoreResp.data?.job_description) {
      jobDescription = scoreResp.data.job_description;
    }

    const selectedLength = getSelectedLength();
    const resp = await sendMessage<{ cover_letter: string }>({
      type: "GENERATE_COVER_LETTER",
      payload: {
        job_title: storedScore.jobTitle,
        company: storedScore.company,
        job_description: jobDescription,
        direct_matches: storedScore.result.direct_matches ?? [],
        transferable: storedScore.result.transferable ?? [],
        gaps: storedScore.result.gaps ?? [],
        green_flags: storedScore.result.green_flags ?? [],
        red_flags: storedScore.result.red_flags ?? [],
        length: selectedLength,
      },
    });

    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Backend returned an error. Make sure the backend is running.");
    }

    const newVersion: CoverLetterVersion = {
      text: resp.data.cover_letter,
      length: selectedLength,
      generatedAt: Date.now(),
    };
    assistData.coverLetters.push(newVersion);
    activeCoverIndex = assistData.coverLetters.length - 1;
    renderCoverTabs();
    scheduleSave();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-msg";
    errorDiv.textContent = `Error: ${msg}`;
    textarea.parentElement?.insertBefore(errorDiv, textarea);
    setTimeout(() => errorDiv.remove(), 6000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "✦ Generate Cover Letter";
  }
}

// ── Q&A section ────────────────────────────────────────────────────────────

function renderQAList(): void {
  const list = document.getElementById("qa-list");
  const emptyEl = document.getElementById("qa-empty");
  if (!list) return;

  // Clear existing blocks (keep empty state el)
  list.querySelectorAll(".qa-block").forEach((el) => el.remove());

  if (assistData.questions.length === 0) {
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  assistData.questions.forEach((qa, idx) => {
    const block = document.createElement("div");
    block.className = "qa-block";
    block.dataset.index = String(idx);

    block.innerHTML = `
      <div class="qa-block-header">
        <textarea class="qa-question-input" placeholder="Paste application question here..." rows="2">${escapeHtml(qa.question)}</textarea>
        <div class="qa-actions">
          <button class="btn-generate-answer" data-index="${idx}">✦ Generate Answer</button>
          <button class="btn-remove-qa" data-index="${idx}" title="Remove">✕</button>
        </div>
      </div>
      <div class="qa-answer-wrap">
        <div class="qa-answer-label">Answer</div>
        <textarea class="qa-answer-textarea" placeholder="AI-generated answer will appear here, or type your own..." rows="4">${escapeHtml(qa.answer)}</textarea>
      </div>
    `;

    // Question input
    const questionInput = block.querySelector(".qa-question-input") as HTMLTextAreaElement;
    questionInput.addEventListener("input", () => {
      assistData.questions[idx].question = questionInput.value;
      scheduleSave();
    });

    // Answer textarea
    const answerTextarea = block.querySelector(".qa-answer-textarea") as HTMLTextAreaElement;
    answerTextarea.addEventListener("input", () => {
      assistData.questions[idx].answer = answerTextarea.value;
      scheduleSave();
    });

    // Generate answer button
    const genBtn = block.querySelector(".btn-generate-answer") as HTMLButtonElement;
    genBtn.addEventListener("click", () => generateAnswer(idx, block));

    // Remove button
    const removeBtn = block.querySelector(".btn-remove-qa") as HTMLButtonElement;
    removeBtn.addEventListener("click", () => {
      assistData.questions.splice(idx, 1);
      renderQAList();
      scheduleSave();
    });

    list.appendChild(block);
  });
}

async function generateAnswer(idx: number, block: HTMLElement): Promise<void> {
  if (!storedScore) return;
  const qa = assistData.questions[idx];
  if (!qa || !qa.question.trim()) return;

  const genBtn = block.querySelector(".btn-generate-answer") as HTMLButtonElement;
  const answerTextarea = block.querySelector(".qa-answer-textarea") as HTMLTextAreaElement;
  if (!genBtn || !answerTextarea) return;

  genBtn.disabled = true;
  genBtn.innerHTML = `<span class="loading-spinner"></span>`;

  try {
    const scoreJobId = jobId.startsWith("hc_") ? jobId.replace("hc_", "") : jobId;
    let jobDescription = "";
    const scoreResp = await sendMessage<{ job_description?: string }>({
      type: "GET_SCORE_FROM_BACKEND",
      jobId: scoreJobId,
    });
    if (scoreResp.success && scoreResp.data?.job_description) {
      jobDescription = scoreResp.data.job_description;
    }

    const resp = await sendMessage<{ answer: string }>({
      type: "GENERATE_APP_ANSWER",
      payload: {
        job_title: storedScore.jobTitle,
        company: storedScore.company,
        job_description: jobDescription,
        direct_matches: storedScore.result.direct_matches ?? [],
        transferable: storedScore.result.transferable ?? [],
        gaps: storedScore.result.gaps ?? [],
        question: qa.question,
      },
    });

    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Backend error");
    }

    assistData.questions[idx].answer = resp.data.answer;
    answerTextarea.value = resp.data.answer;
    scheduleSave();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    answerTextarea.value = `Error: ${msg}`;
  } finally {
    genBtn.disabled = false;
    genBtn.innerHTML = "↺ Regenerate";
  }
}

// ── Salary section ─────────────────────────────────────────────────────────

function computePercentile(ask: number, low: number, high: number): string {
  if (ask < low) return "Below estimated range";
  if (ask > high) return "Above estimated range";
  const pct = Math.round(((ask - low) / (high - low)) * 100);
  return `${pct}th percentile of estimated range`;
}

function formatSalary(n: number): string {
  return `$${Math.round(n / 1000)}k`;
}

function renderSalarySection(): void {
  const container = document.getElementById("salary-content");
  if (!container) return;

  if (!salaryEstimate) {
    container.innerHTML = `<div class="no-salary-msg">No salary estimate available for this role.</div>`;
    return;
  }

  const low = salaryEstimate.low;
  const high = salaryEstimate.high;
  const mid = Math.round((low + high) / 2);
  const initialAsk = assistData.salaryAsk ?? mid;

  // Slider range: allow 20% below low and 30% above high
  const sliderMin = Math.round(low * 0.8);
  const sliderMax = Math.round(high * 1.3);
  const sliderStep = 1000;

  const initialPercentile = computePercentile(initialAsk, low, high);
  const isOutside = initialPercentile.startsWith("Below") || initialPercentile.startsWith("Above");

  container.innerHTML = `
    <div class="salary-context">
      <div class="salary-range-label">Estimated Market Range</div>
      <div class="salary-range-values">${formatSalary(low)} – ${formatSalary(high)} / year</div>
      ${salaryEstimate.assessment ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(salaryEstimate.assessment)}</div>` : ""}
    </div>
    <div class="salary-slider-wrap">
      <div style="font-size:11px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Your Ask</div>
      <div class="salary-slider-row">
        <span style="font-size:11px;color:#475569">${formatSalary(sliderMin)}</span>
        <input type="range" id="salary-slider" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" value="${initialAsk}" />
        <span style="font-size:11px;color:#475569">${formatSalary(sliderMax)}</span>
        <input type="number" id="salary-manual" class="salary-manual-input" value="${initialAsk}" min="${sliderMin}" max="${sliderMax}" step="1000" />
      </div>
      <div class="salary-percentile" id="salary-percentile">
        <span class="${isOutside ? "percentile-warn" : "percentile-value"}">${initialPercentile}</span>
      </div>
    </div>
  `;

  const slider = document.getElementById("salary-slider") as HTMLInputElement;
  const manual = document.getElementById("salary-manual") as HTMLInputElement;
  const percentileEl = document.getElementById("salary-percentile");

  function updatePercentileDisplay(ask: number): void {
    if (!percentileEl) return;
    const label = computePercentile(ask, low, high);
    const isOut = label.startsWith("Below") || label.startsWith("Above");
    percentileEl.innerHTML = `<span class="${isOut ? "percentile-warn" : "percentile-value"}">${label}</span>`;
  }

  slider.addEventListener("input", () => {
    const val = parseInt(slider.value, 10);
    manual.value = String(val);
    assistData.salaryAsk = val;
    updatePercentileDisplay(val);
    scheduleSave();
  });

  manual.addEventListener("input", () => {
    const val = parseInt(manual.value, 10);
    if (!isNaN(val)) {
      slider.value = String(Math.max(sliderMin, Math.min(sliderMax, val)));
      assistData.salaryAsk = val;
      updatePercentileDisplay(val);
      scheduleSave();
    }
  });
}

// ── Footer actions ─────────────────────────────────────────────────────────

async function markApplied(): Promise<void> {
  const btn = document.getElementById("btn-mark-applied") as HTMLButtonElement | null;
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="loading-spinner"></span>Marking...`;

  const resp = await sendMessage({
    type: "UPDATE_JOB_STATUS",
    jobId,
    dbId: storedScore?.result?.db_id ?? dbId,
    status: "applied",
    appliedDate: new Date().toISOString(),
  });

  if (resp.success !== false) {
    currentStatus = "applied";
    chrome.storage.local.set({ [`status_${jobId}`]: "applied" });
    btn.innerHTML = "Applied ✓";
    // Update status badge in header
    const badge = document.getElementById("status-badge");
    if (badge) {
      const cfg = STATUS_CONFIG["applied"];
      badge.textContent = cfg.label;
      badge.style.background = cfg.bg;
      badge.style.color = cfg.color;
      badge.style.border = `1px solid ${cfg.border}`;
    }
  } else {
    btn.disabled = false;
    btn.innerHTML = "Mark as Applied";
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

function init(): void {
  jobId = location.hash.replace("#", "").trim();
  if (!jobId) {
    const titleEl = document.getElementById("header-title");
    if (titleEl) titleEl.textContent = "No job selected";
    return;
  }

  setupCollapsible("hdr-cover", "body-cover", "chv-cover");
  setupCollapsible("hdr-questions", "body-questions", "chv-questions");
  setupCollapsible("hdr-salary", "body-salary", "chv-salary");

  const storageKeys = [`score_jobid_${jobId}`, `status_${jobId}`, `app_assist_${jobId}`];

  chrome.storage.local.get(storageKeys, async (data) => {
    storedScore = (data[`score_jobid_${jobId}`] as StoredScore) ?? null;
    currentStatus = (data[`status_${jobId}`] as string) ?? null;
    const saved = data[`app_assist_${jobId}`] as AppAssistLocalData | undefined;

    if (storedScore) {
      renderHeader(storedScore, currentStatus);
      dbId = storedScore.dbId ?? storedScore.result.db_id ?? null;
      salaryEstimate = storedScore.result.salary_estimate ?? null;
    }

    if (saved) {
      // Migrate old single-letter format to array format
      const legacySaved = saved as AppAssistLocalData & { coverLetter?: string; coverLetterLength?: string; generatedAt?: number };
      let coverLetters: CoverLetterVersion[] = saved.coverLetters ?? [];
      if (coverLetters.length === 0 && legacySaved.coverLetter) {
        coverLetters = [{
          text: legacySaved.coverLetter,
          length: (legacySaved.coverLetterLength as "short" | "medium" | "long") ?? "medium",
          generatedAt: legacySaved.generatedAt ?? Date.now(),
        }];
      }
      assistData = {
        coverLetters,
        salaryAsk: saved.salaryAsk ?? null,
        questions: saved.questions ?? [],
        updatedAt: saved.updatedAt ?? Date.now(),
      };
      activeCoverIndex = Math.max(0, coverLetters.length - 1);
    }

    restoreCoverLetter();
    renderQAList();
    renderSalarySection();

    // If already applied, disable the mark applied button
    if (currentStatus === "applied" || currentStatus === "offer") {
      const btn = document.getElementById("btn-mark-applied") as HTMLButtonElement | null;
      if (btn && currentStatus === "applied") {
        btn.innerHTML = "Applied ✓";
        btn.disabled = true;
      }
    }

    // Background DB sync if we have a dbId
    if (dbId) {
      const dbResp = await sendMessage<{ cover_letter?: string; cover_letter_length?: string; salary_ask?: number; questions?: QAItem[]; updated_at?: string }>({
        type: "GET_APP_ASSIST",
        dbId,
      });
      if (dbResp.success && dbResp.data) {
        const remoteUpdatedAt = dbResp.data.updated_at ? new Date(dbResp.data.updated_at).getTime() : 0;
        if (remoteUpdatedAt > assistData.updatedAt) {
          // Merge remote single-version into the local array if it's newer and not already present
          const remoteLetter = dbResp.data.cover_letter;
          const remoteLength = (dbResp.data.cover_letter_length as "short" | "medium" | "long") ?? "medium";
          if (remoteLetter && !assistData.coverLetters.some((v) => v.text === remoteLetter)) {
            assistData.coverLetters.push({ text: remoteLetter, length: remoteLength, generatedAt: remoteUpdatedAt });
            activeCoverIndex = assistData.coverLetters.length - 1;
          }
          assistData.salaryAsk = dbResp.data.salary_ask ?? null;
          assistData.questions = dbResp.data.questions ?? [];
          assistData.updatedAt = remoteUpdatedAt;
          restoreCoverLetter();
          renderQAList();
          renderSalarySection();
          chrome.storage.local.set({ [`app_assist_${jobId}`]: assistData });
        }
      }
    }
  });

  // Cover letter events
  document.getElementById("cover-length-slider")?.addEventListener("input", () => {
    updateLengthLabel();
  });

  document.getElementById("cover-letter-text")?.addEventListener("input", (e) => {
    if (assistData.coverLetters[activeCoverIndex]) {
      assistData.coverLetters[activeCoverIndex].text = (e.target as HTMLTextAreaElement).value;
      scheduleSave();
    }
  });

  document.getElementById("btn-generate-cover")?.addEventListener("click", generateCoverLetter);

  // Copy cover letter
  document.getElementById("btn-copy-cover")?.addEventListener("click", () => {
    const activeText = assistData.coverLetters[activeCoverIndex]?.text ?? "";
    if (!activeText.trim()) return;
    navigator.clipboard.writeText(activeText).then(() => {
      const btn = document.getElementById("btn-copy-cover") as HTMLButtonElement | null;
      if (!btn) return;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    }).catch(() => {});
  });

  // Add question
  document.getElementById("btn-add-question")?.addEventListener("click", () => {
    assistData.questions.push({ question: "", answer: "" });
    renderQAList();
    scheduleSave();
    // Focus the new question input
    const blocks = document.querySelectorAll<HTMLTextAreaElement>(".qa-question-input");
    blocks[blocks.length - 1]?.focus();
  });

  // Footer
  document.getElementById("btn-mark-applied")?.addEventListener("click", markApplied);
  document.getElementById("btn-return-dashboard")?.addEventListener("click", () => window.close());
  document.getElementById("btn-back")?.addEventListener("click", () => window.close());
}

init();
