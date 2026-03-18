console.log("[JobScout] Content script loaded on:", window.location.href);

import { checkAndInjectFromStorage, updateBadgeForJobId } from "./badge";
import { addJobToOverlay, updateOverlayActiveJob } from "./overlay";
import {
  extractLinkedIn,
  isLinkedInJobPage,
  extractLinkedInCardJobId,
} from "./extractors/linkedin";
import {
  extractIndeed,
  isIndeedJobPage,
  extractIndeedCardJobId,
} from "./extractors/indeed";
import { extractHiringCafe, isHiringCafePage } from "./extractors/hiring-cafe";
import { JobExtraction } from "./extractors/types";

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

let analysisInProgress = false;
let lastAnalyzedJobId = "";

function detectSite(url: string): "linkedin" | "indeed" | "hiring-cafe" | null {
  if (isLinkedInJobPage(url)) return "linkedin";
  if (isIndeedJobPage(url)) return "indeed";
  if (isHiringCafePage(url)) return "hiring-cafe";
  return null;
}

function extractCurrentJob(url: string): JobExtraction | null {
  const site = detectSite(url);
  if (!site) {
    console.log("[JobScout] Not a supported job page:", url);
    return null;
  }

  console.log(`[JobScout] Detected site: ${site}`);

  let result;
  if (site === "linkedin") result = extractLinkedIn(url);
  else if (site === "indeed") result = extractIndeed(url);
  else result = extractHiringCafe(url);

  if (!result.success || !result.data) {
    console.warn("[JobScout] Extraction failed:", result.reason);
    return null;
  }

  return result.data;
}

function extractCardJobId(card: Element, url: string): string | null {
  const site = detectSite(url);
  if (site === "linkedin") return extractLinkedInCardJobId(card);
  if (site === "indeed") return extractIndeedCardJobId(card);
  return null;
}

async function analyzeJob(forceJobId?: string): Promise<void> {
  const currentUrl = window.location.href;

  if (analysisInProgress) {
    console.log("[JobScout] Analysis already in progress, skipping");
    return;
  }

  const data = extractCurrentJob(currentUrl);
  if (!data) {
    console.warn("[JobScout] Extraction failed, aborting");
    return;
  }

  const effectiveJobId = forceJobId ?? data.jobId;

  if (lastAnalyzedJobId === effectiveJobId && !forceJobId) {
    console.log("[JobScout] Already analyzed this job, skipping");
    return;
  }

  // Check cache first — keyed by jobId
  const cacheKey = `score_jobid_${effectiveJobId}`;
  chrome.storage.local.get(cacheKey, (cached) => {
    if (cached[cacheKey] && !forceJobId) {
      console.log("[JobScout] Cache hit for job:", effectiveJobId);
      const stored = cached[cacheKey] as {
        result: AnalyzeResponse;
        jobTitle: string;
        company: string;
        salary: string | null;
        easyApply: boolean;
        jobAge: string | null;
        jobAgeIsOld: boolean;
      };
      lastAnalyzedJobId = effectiveJobId;
      displayResult(stored.result, data, effectiveJobId, currentUrl);
      return;
    }

    sendToBackend(data, effectiveJobId, currentUrl, forceJobId);
  });
}
// Near the other module-level variables
const inflightJobIds = new Set<string>();
const completedJobIds = new Set<string>();

function sendToBackend(
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
  forceJobId?: string,
): void {
  if (!forceJobId && inflightJobIds.has(effectiveJobId)) {
    console.log(
      "[JobScout] Already in-flight, skipping duplicate sendToBackend:",
      effectiveJobId,
    );
    return;
  }
  inflightJobIds.add(effectiveJobId);
  analysisInProgress = true;
  // ... rest unchanged
  analysisInProgress = true;
  lastAnalyzedJobId = effectiveJobId;

  // Signal to popup that analysis is in progress for this job
  chrome.storage.local.set({ hc_pending_job_id: effectiveJobId });

  console.log(
    "[JobScout] Sending to background worker:",
    data.jobTitle,
    "at",
    data.company,
  );

  chrome.runtime.sendMessage(
    {
      type: forceJobId ? "REANALYZE_JOB" : "ANALYZE_JOB",
      payload: {
        job_title: data.jobTitle,
        company: data.company,
        job_description: data.jobDescription,
        url: currentUrl,
        listed_salary: data.salary,
      },
    },
    (response) => {
      analysisInProgress = false;

      if (chrome.runtime.lastError) {
        console.error(
          "[JobScout] Message error:",
          chrome.runtime.lastError.message,
        );
        lastAnalyzedJobId = "";
        // If there's a bulk queue waiting, process the next one
        return;
      }

      if (!response.success) {
        console.error("[JobScout] Backend error:", response.error);
        lastAnalyzedJobId = "";
        return;
      }

      const result: AnalyzeResponse = response.data;
      saveAndDisplay(result, data, effectiveJobId, currentUrl);
    },
  );
}

function saveAndDisplay(
  result: AnalyzeResponse,
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
): void {
  const cachePayload: Record<string, unknown> = {};
  cachePayload["hc_pending_job_id"] = null; // Clear pending flag on save
  // Key by jobId — works correctly across all sites including hiring.cafe
  cachePayload[`score_jobid_${effectiveJobId}`] = {
    result,
    jobTitle: data.jobTitle,
    company: data.company,
    salary: data.salary,
    easyApply: data.easyApply,
    jobAge: data.jobAge,
    jobAgeIsOld: data.jobAgeIsOld,
    timestamp: Date.now(),
  };

  cachePayload[`jobid_${effectiveJobId}`] = {
    score: result.fit_score,
    shouldApply: result.should_apply,
    verdict: result.one_line_verdict,
  };

  chrome.storage.local.set(cachePayload, () => {
    inflightJobIds.delete(effectiveJobId);
    console.log(
      "[JobScout] Score saved, updating badges for job:",
      effectiveJobId,
    );
    displayResult(result, data, effectiveJobId, currentUrl);

    if (bulkModeActive && !completedJobIds.has(effectiveJobId)) {
      completedJobIds.add(effectiveJobId);
      bulkMarkComplete(effectiveJobId);
      processBulkQueueNext();
    }
  });
}

function displayResult(
  result: AnalyzeResponse,
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
): void {
  updateBadgeForJobId(
    effectiveJobId,
    result.fit_score,
    result.should_apply,
    result.one_line_verdict,
  );
  // Update hiring.cafe card badge if present
  if (detectSite(currentUrl) === "hiring-cafe") {
    // Find card by current jobId OR update card that modal belongs to
    let card = document.querySelector<HTMLElement>(
      `[data-jobscout-hc-id="${effectiveJobId}"]`,
    );

    // If not found by jobId, find the card whose modal is currently open
    // (carousel case — card still has old jobId)
    if (!card) {
      const modal = document.querySelector<HTMLElement>(".chakra-modal__body");
      if (modal) {
        const titleEl = modal.querySelector<HTMLElement>(
          "h2.font-extrabold, h2[class*='font-extrabold'], h1",
        );
        const modalTitle = titleEl?.innerText?.trim() ?? "";
        if (modalTitle) {
          // Find card whose title span matches the modal title
          document
            .querySelectorAll<HTMLElement>("div.relative.bg-white.rounded-xl")
            .forEach((c) => {
              const titleSpan = c.querySelector<HTMLElement>(
                "span[class*='font-bold'][class*='line-clamp']",
              );
              if (titleSpan?.innerText?.trim() === modalTitle) {
                card = c;
              }
            });
        }
      }
    }

    if (card) {
      // Update card's jobId to current job (fixes carousel)
      card.setAttribute("data-jobscout-hc-id", effectiveJobId);

      const badgeTarget = card.querySelector<HTMLElement>("div.mt-1");
      if (badgeTarget) {
        // Remove any existing badge (from previous carousel position)
        badgeTarget
          .querySelectorAll("[data-jobscout-badge]")
          .forEach((b) => b.remove());

        const badge = document.createElement("span");
        badge.setAttribute("data-jobscout-badge", effectiveJobId);
        badge.style.cssText = `
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          margin-left: 6px;
          vertical-align: middle;
          background: ${result.fit_score >= 80 ? "#052e16" : result.fit_score >= 60 ? "#1c1917" : result.fit_score >= 40 ? "#1c0a00" : "#2d1515"};
          color: ${result.fit_score >= 80 ? "#4ade80" : result.fit_score >= 60 ? "#facc15" : result.fit_score >= 40 ? "#fb923c" : "#f87171"};
          border: 1px solid ${result.fit_score >= 80 ? "#4ade80" : result.fit_score >= 60 ? "#facc15" : result.fit_score >= 40 ? "#fb923c" : "#f87171"};
          cursor: default;
        `;
        badge.textContent = `${result.fit_score}`;
        badge.title = result.one_line_verdict;
        badgeTarget.appendChild(badge);
        console.log(
          "[JobScout Badge] Injected HC card badge post-analysis:",
          effectiveJobId,
          "→",
          result.fit_score,
        );
      }
    }
  }
  addJobToOverlay({
    jobId: effectiveJobId,
    jobTitle: data.jobTitle,
    company: data.company,
    score: result.fit_score,
    shouldApply: result.should_apply,
    salary: data.salary,
    salaryEstimateLow: result.salary_estimate?.low ?? null,
    salaryEstimateHigh: result.salary_estimate?.high ?? null,
    easyApply: data.easyApply,
    url: currentUrl,
  });

  console.log("[JobScout] ===== SCORE RESULT =====");
  console.log(`[JobScout] Site:         ${detectSite(currentUrl)}`);
  console.log(`[JobScout] Fit Score:    ${result.fit_score}/100`);
  console.log(`[JobScout] Should Apply: ${result.should_apply}`);
  console.log(`[JobScout] Verdict:      ${result.one_line_verdict}`);
  console.log(`[JobScout] Salary:       ${data.salary ?? "not found"}`);
  console.log(`[JobScout] Easy Apply:   ${data.easyApply}`);
  console.log(
    `[JobScout] Job Age:      ${data.jobAge ?? "not found"} (old: ${data.jobAgeIsOld})`,
  );
  console.log("[JobScout] =========================");
}

function waitForContentThenAnalyze(forceJobId?: string): void {
  console.log("[JobScout] Waiting for job content to render...");
  let attempts = 0;
  const maxAttempts = 20;

  const interval = setInterval(() => {
    attempts++;
    const currentUrl = window.location.href;
    const site = detectSite(currentUrl);

    if (!site) {
      clearInterval(interval);
      return;
    }

    const descriptionSelectors: Record<string, string> = {
      linkedin: ".jobs-description__content .jobs-box__html-content",
      indeed: "#jobDescriptionText, .jobsearch-jobDescriptionText",
      "hiring-cafe": ".chakra-modal__body",
    };

    const selector = descriptionSelectors[site];
    const el = document.querySelector<HTMLElement>(selector);

    if (el && el.innerText.trim().length > 100) {
      clearInterval(interval);
      console.log(
        `[JobScout] ${site} content ready after ${attempts} attempts`,
      );
      analyzeJob(forceJobId);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn(
        "[JobScout] Content never rendered after",
        maxAttempts,
        "attempts",
      );
    }
  }, 300);
}

function onUrlChange(newUrl: string): void {
  console.log("[JobScout] URL changed to:", newUrl);

  const site = detectSite(newUrl);
  if (!site) {
    console.log("[JobScout] Not a supported job page, skipping");
    return;
  }

  if (site === "hiring-cafe") return;

  const jobIdMatch = newUrl.match(/currentJobId=(\d+)/);
  if (jobIdMatch) {
    updateOverlayActiveJob(jobIdMatch[1]);
  }

  waitForContentThenAnalyze();
}

// ===== BULK SCORING =====
// Queue-based: you open each card manually, extraction queues automatically,
// background processor fires one at a time without blocking your browsing.

interface BulkQueueItem {
  jobId: string;
  data: JobExtraction;
  url: string;
}

let bulkQueue: BulkQueueItem[] = [];
let bulkProcessing = false;
let bulkTotal = 0;
let bulkCompleted = 0;

let bulkModeActive = false; // ADD THIS LINE near the other bulk variables

function bulkHashTitle(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  return `hc_${Math.abs(hash).toString(16)}`;
}

function isInBulkQueue(jobId: string): boolean {
  return bulkQueue.some((item) => item.jobId === jobId);
}

function addToBulkQueue(jobId: string, data: JobExtraction, url: string): void {
  if (isInBulkQueue(jobId)) {
    console.log("[JobScout Bulk] Already in queue:", jobId);
    return;
  }

  // Check cache — skip if already scored
  chrome.storage.local.get(`score_jobid_${jobId}`, (cached) => {
    if (cached[`score_jobid_${jobId}`]) {
      console.log("[JobScout Bulk] Already scored, not queuing:", jobId);
      return;
    }

    bulkQueue.push({ jobId, data, url });
    bulkTotal++;
    console.log(
      `[JobScout Bulk] Queued: ${data.jobTitle} (queue size: ${bulkQueue.length})`,
    );
    updateBulkProgress();

    // Start processing if not already running
    if (!bulkProcessing && !analysisInProgress) {
      processBulkQueueNext();
    }
  });
}

function bulkMarkComplete(jobId: string): void {
  const idx = bulkQueue.findIndex((item) => item.jobId === jobId);
  if (idx !== -1) {
    bulkQueue.splice(idx, 1);
    bulkCompleted++;
    console.log(
      `[JobScout Bulk] Completed: ${jobId} (${bulkCompleted}/${bulkTotal})`,
    );
    updateBulkProgress();
  }
}

function processBulkQueueNext(): void {
  if (bulkProcessing || analysisInProgress) return;
  if (bulkQueue.length === 0) {
    if (bulkTotal > 0) {
      console.log(`[JobScout Bulk] Queue empty — ${bulkCompleted} jobs scored`);
      updateBulkProgress();
    }
    return;
  }

  const next = bulkQueue[0];
  console.log(
    `[JobScout Bulk] Processing next: ${next.data.jobTitle} (${bulkQueue.length} remaining)`,
  );

  chrome.storage.local.get(`score_jobid_${next.jobId}`, (cached) => {
    if (cached[`score_jobid_${next.jobId}`]) {
      console.log(
        "[JobScout Bulk] Already scored since queuing, skipping:",
        next.jobId,
      );
      bulkMarkComplete(next.jobId);
      processBulkQueueNext();
      return;
    }

    // Set analysisInProgress directly here before sendToBackend so nothing
    // else can sneak in between the cache check and the API call
    analysisInProgress = true;
    lastAnalyzedJobId = next.jobId;
    chrome.storage.local.set({ hc_pending_job_id: next.jobId });

    console.log(
      "[JobScout] Sending to background worker:",
      next.data.jobTitle,
      "at",
      next.data.company,
    );

    chrome.runtime.sendMessage(
      {
        type: "ANALYZE_JOB",
        payload: {
          job_title: next.data.jobTitle,
          company: next.data.company,
          job_description: next.data.jobDescription,
          url: next.url,
          listed_salary: next.data.salary,
        },
      },
      (response) => {
        analysisInProgress = false;

        if (chrome.runtime.lastError) {
          console.error(
            "[JobScout] Message error:",
            chrome.runtime.lastError.message,
          );
          bulkMarkComplete(next.jobId);
          processBulkQueueNext();
          return;
        }

        if (!response.success) {
          console.error("[JobScout] Backend error:", response.error);
          bulkMarkComplete(next.jobId);
          processBulkQueueNext();
          return;
        }

        const result: AnalyzeResponse = response.data;
        saveAndDisplay(result, next.data, next.jobId, next.url);
      },
    );
  });
}

function updateBulkProgress(): void {
  chrome.runtime.sendMessage({
    type: "BULK_PROGRESS",
    completed: bulkCompleted,
    total: bulkTotal,
    queued: bulkQueue.length,
    running: bulkQueue.length > 0 || analysisInProgress,
  });
}

function startBulkScoring(): void {
  bulkModeActive = true;
  chrome.storage.local.set({ hc_bulk_mode_active: true });
  console.log(
    "[JobScout Bulk] Bulk queue mode enabled — open cards to queue them",
  );
  updateBulkProgress();
}

function cancelBulkScoring(): void {
  bulkQueue = [];
  bulkProcessing = false;
  bulkTotal = 0;
  bulkCompleted = 0;
  bulkModeActive = false;
  chrome.storage.local.set({ hc_bulk_mode_active: false });
  updateBulkProgress();
  console.log("[JobScout Bulk] Queue cleared and bulk mode disabled");
}

// ===== HIRING CAFE MODAL WATCHER =====

function initHiringCafeModalWatcher(): void {
  if (!isHiringCafePage(window.location.href)) return;

  console.log("[JobScout] Initializing Hiring.cafe modal watcher");
  let lastModalJobId = "";

  const modalObserver = new MutationObserver(() => {
    const modal = document.querySelector<HTMLElement>(".chakra-modal__body");
    if (!modal || modal.innerText.trim().length < 100) return;

    const titleEl = modal.querySelector<HTMLElement>(
      "h2.font-extrabold, h2[class*='font-extrabold'], h1",
    );
    const title = titleEl?.innerText?.trim() ?? "";
    if (!title) return;

    const currentJobId = bulkHashTitle(title);

    if (currentJobId === lastModalJobId) return;
    lastModalJobId = currentJobId;

    console.log("[JobScout] Hiring.cafe modal detected for:", title);
    analysisInProgress = false;
    lastAnalyzedJobId = "";

    setTimeout(() => {
      const currentUrl = window.location.href;
      const extractionResult = extractHiringCafe(currentUrl);

      if (extractionResult.success && extractionResult.data) {
        const data = extractionResult.data;
        const jobId = currentJobId;

        chrome.storage.local.get(`score_jobid_${jobId}`, (cached) => {
          if (cached[`score_jobid_${jobId}`]) {
            console.log("[JobScout] Cache hit for job:", jobId);
            displayResult(
              (cached[`score_jobid_${jobId}`] as { result: AnalyzeResponse })
                .result,
              data,
              jobId,
              currentUrl,
            );
          } else if (bulkModeActive) {
            // Bulk mode — queue only, do NOT call waitForContentThenAnalyze
            console.log("[JobScout] Bulk mode: queuing job:", data.jobTitle);
            addToBulkQueue(jobId, data, currentUrl);
            // Do not fall through to waitForContentThenAnalyze
          } else {
            // Normal single-job mode
            waitForContentThenAnalyze(jobId);
          }
        });
      } else {
        if (!bulkModeActive) {
          waitForContentThenAnalyze(currentJobId);
        }
      }
    }, 500);
  });

  modalObserver.observe(document.body, { childList: true, subtree: true });
}

function initCardObserver(): void {
  console.log("[JobScout] Initializing card observer");

  const cardSelectors: Record<string, string> = {
    linkedin:
      ".job-card-container, .jobs-search-results__list-item, [data-job-id]",
    indeed: "[id^='sj_'], .job_seen_beacon, .resultContent",
    "hiring-cafe": "div.relative.bg-white.rounded-xl",
  };

  const scanCards = (): void => {
    const site = detectSite(window.location.href);
    if (!site) return;

    const selector = cardSelectors[site];
    document.querySelectorAll(selector).forEach((card) => {
      if (card.hasAttribute("data-jobscout-processed")) return;

      if (site === "hiring-cafe") {
        const titleSpan = card.querySelector<HTMLElement>(
          "span[class*='font-bold'][class*='line-clamp']",
        );
        if (!titleSpan) return;

        const title = titleSpan.innerText.trim();
        if (!title || title.length < 3) return;

        const jobId = bulkHashTitle(title);

        card.setAttribute("data-jobscout-processed", "true");
        card.setAttribute("data-jobscout-hc-id", jobId);

        const badgeTarget = titleSpan.closest("div.mt-1");
        if (!badgeTarget) return;

        const storageKey = `jobid_${jobId}`;
        chrome.storage.local.get(storageKey, (data) => {
          const stored = data[storageKey] as
            | { score: number; shouldApply: boolean; verdict: string }
            | undefined;
          if (stored) {
            const badge = document.createElement("span");
            badge.setAttribute("data-jobscout-badge", jobId);
            badge.style.cssText = `
              display: inline-block;
              font-size: 10px;
              font-weight: 700;
              padding: 1px 5px;
              border-radius: 4px;
              margin-left: 6px;
              vertical-align: middle;
              background: ${stored.score >= 80 ? "#052e16" : stored.score >= 60 ? "#1c1917" : stored.score >= 40 ? "#1c0a00" : "#2d1515"};
              color: ${stored.score >= 80 ? "#4ade80" : stored.score >= 60 ? "#facc15" : stored.score >= 40 ? "#fb923c" : "#f87171"};
              border: 1px solid ${stored.score >= 80 ? "#4ade80" : stored.score >= 60 ? "#facc15" : stored.score >= 40 ? "#fb923c" : "#f87171"};
              cursor: default;
            `;
            badge.textContent = `${stored.score}`;
            badge.title = stored.verdict;
            badgeTarget.appendChild(badge);
            console.log(
              "[JobScout Badge] Injected HC card badge for:",
              title.substring(0, 30),
              "→",
              stored.score,
            );
          }
        });
        return;
      }

      card.setAttribute("data-jobscout-processed", "true");
      checkAndInjectFromStorage(card);
    });
  };

  const cardObserver = new MutationObserver(() => scanCards());
  cardObserver.observe(document.body, { childList: true, subtree: true });
  scanCards();
}

function initUrlWatcher(): void {
  let currentUrl = window.location.href;

  const observer = new MutationObserver(() => {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
      currentUrl = newUrl;
      onUrlChange(newUrl);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[JobScout] URL watcher initialized");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRIGGER_REANALYZE") {
    console.log("[JobScout] Re-analyze triggered from popup");
    lastAnalyzedJobId = "";
    analysisInProgress = false;
    waitForContentThenAnalyze();
  }

  if (message.type === "START_BULK_SCORING") {
    console.log("[JobScout] Bulk scoring status requested from popup");
    startBulkScoring();
  }

  if (message.type === "CANCEL_BULK_SCORING") {
    console.log("[JobScout] Bulk scoring cancelled from popup");
    cancelBulkScoring();
  }

  if (message.type === "GET_BULK_STATUS") {
    updateBulkProgress();
  }
});

initUrlWatcher();
initCardObserver();
initHiringCafeModalWatcher();
onUrlChange(window.location.href);
