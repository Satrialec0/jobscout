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

function sendToBackend(
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
  forceJobId?: string,
): void {
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
  // ... rest of function unchanged

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
    console.log(
      "[JobScout] Score saved, updating badges for job:",
      effectiveJobId,
    );
    displayResult(result, data, effectiveJobId, currentUrl);
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

    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0;
    }
    const currentJobId = `hc_${Math.abs(hash).toString(16)}`;

    if (currentJobId === lastModalJobId) return;
    lastModalJobId = currentJobId;

    console.log("[JobScout] Hiring.cafe modal detected for:", title);
    analysisInProgress = false;
    lastAnalyzedJobId = "";
    setTimeout(() => waitForContentThenAnalyze(currentJobId), 500);
  });

  modalObserver.observe(document.body, { childList: true, subtree: true });
}

function initCardObserver(): void {
  console.log("[JobScout] Initializing card observer");

  const cardSelectors: Record<string, string> = {
    linkedin:
      ".job-card-container, .jobs-search-results__list-item, [data-job-id]",
    indeed: "[id^='sj_'], .job_seen_beacon, .resultContent",
    "hiring-cafe": "[class*='job-card'], [class*='jobCard'], [class*='result']",
  };

  const processCard = (card: Element): void => {
    if (card.hasAttribute("data-jobscout-processed")) return;
    card.setAttribute("data-jobscout-processed", "true");
    checkAndInjectFromStorage(card);
  };

  const scanCards = (): void => {
    const site = detectSite(window.location.href);
    if (!site || site === "hiring-cafe") return;

    const selector = cardSelectors[site];
    document.querySelectorAll(selector).forEach(processCard);
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
});

initUrlWatcher();
initCardObserver();
initHiringCafeModalWatcher();
onUrlChange(window.location.href);
