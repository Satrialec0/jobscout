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
import {
  extractHiringCafe,
  isHiringCafePage,
  extractHiringCafeCardJobId,
} from "./extractors/hiring-cafe";
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
let lastAnalyzedUrl = "";

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
  if (site === "hiring-cafe") return extractHiringCafeCardJobId(card);
  return null;
}

async function analyzeJob(): Promise<void> {
  const currentUrl = window.location.href;

  if (analysisInProgress) {
    console.log("[JobScout] Analysis already in progress, skipping");
    return;
  }

  if (lastAnalyzedUrl === currentUrl) {
    console.log("[JobScout] Already analyzed this URL, skipping");
    return;
  }

  const data = extractCurrentJob(currentUrl);
  if (!data) {
    console.warn("[JobScout] Extraction failed, aborting");
    return;
  }

  analysisInProgress = true;
  lastAnalyzedUrl = currentUrl;
  console.log(
    "[JobScout] Sending to background worker:",
    data.jobTitle,
    "at",
    data.company,
  );

  chrome.runtime.sendMessage(
    {
      type: "ANALYZE_JOB",
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
        lastAnalyzedUrl = "";
        return;
      }

      if (!response.success) {
        console.error("[JobScout] Backend error:", response.error);
        lastAnalyzedUrl = "";
        return;
      }

      const result: AnalyzeResponse = response.data;

      const storagePayload: Record<string, unknown> = {
        [`score_${currentUrl}`]: {
          result,
          jobTitle: data.jobTitle,
          company: data.company,
          timestamp: Date.now(),
          salary: data.salary,
          easyApply: data.easyApply,
          jobAge: data.jobAge,
          jobAgeIsOld: data.jobAgeIsOld,
        },
      };

      storagePayload[`jobid_${data.jobId}`] = {
        score: result.fit_score,
        shouldApply: result.should_apply,
        verdict: result.one_line_verdict,
      };

      chrome.storage.local.set(storagePayload, () => {
        console.log(
          "[JobScout] Score saved, updating badges for job:",
          data.jobId,
        );
        updateBadgeForJobId(
          data.jobId,
          result.fit_score,
          result.should_apply,
          result.one_line_verdict,
        );
        addJobToOverlay({
          jobId: data.jobId,
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
    },
  );
}

function waitForContentThenAnalyze(): void {
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
      "hiring-cafe":
        "[class*='description'], [class*='job-body'], main article",
    };

    const selector = descriptionSelectors[site];
    const el = document.querySelector<HTMLElement>(selector);

    if (el && el.innerText.trim().length > 100) {
      clearInterval(interval);
      console.log(
        `[JobScout] ${site} content ready after ${attempts} attempts`,
      );
      analyzeJob();
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

  const jobIdMatch = newUrl.match(/currentJobId=(\d+)/);
  if (jobIdMatch) {
    updateOverlayActiveJob(jobIdMatch[1]);
  }

  waitForContentThenAnalyze();
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
    if (!site) return;

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
    lastAnalyzedUrl = "";
    analysisInProgress = false;
    waitForContentThenAnalyze();
  }
});

initUrlWatcher();
initCardObserver();
onUrlChange(window.location.href);
