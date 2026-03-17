console.log("[JobScout] Content script loaded on:", window.location.href);

import { checkAndInjectFromStorage, updateBadgeForJobId } from "./badge";

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

let analysisInProgress = false;
let lastAnalyzedUrl = "";

function extractLinkedInJob(): {
  jobTitle: string;
  company: string;
  jobDescription: string;
} | null {
  console.log("[JobScout] Attempting LinkedIn extraction");

  const jobTitleEl = document.querySelector<HTMLElement>(
    ".job-details-jobs-unified-top-card__job-title h1",
  );
  const companyEl = document.querySelector<HTMLElement>(
    ".job-details-jobs-unified-top-card__company-name a",
  );
  const descriptionEl = document.querySelector<HTMLElement>(
    ".jobs-description__content .jobs-box__html-content",
  );

  if (!jobTitleEl || !companyEl || !descriptionEl) {
    console.warn("[JobScout] Could not find all required elements", {
      jobTitleFound: !!jobTitleEl,
      companyFound: !!companyEl,
      descriptionFound: !!descriptionEl,
    });
    return null;
  }

  const jobTitle = jobTitleEl.innerText.trim();
  const company = companyEl.innerText.trim();
  const jobDescription = descriptionEl.innerText.trim();

  if (jobDescription.length < 100) {
    console.warn("[JobScout] Description too short:", jobDescription.length);
    return null;
  }

  console.log("[JobScout] Extracted:", {
    jobTitle,
    company,
    descriptionLength: jobDescription.length,
  });

  return { jobTitle, company, jobDescription };
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

  const data = extractLinkedInJob();
  if (!data) {
    console.warn("[JobScout] Extraction failed, aborting");
    return;
  }

  analysisInProgress = true;
  lastAnalyzedUrl = currentUrl;
  console.log("[JobScout] Sending to background worker for:", currentUrl);

  chrome.runtime.sendMessage(
    {
      type: "ANALYZE_JOB",
      payload: {
        job_title: data.jobTitle,
        company: data.company,
        job_description: data.jobDescription,
        url: currentUrl,
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

      const jobIdMatch = currentUrl.match(/currentJobId=(\d+)/);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;

      const storagePayload: Record<string, unknown> = {
        [`score_${currentUrl}`]: {
          result,
          jobTitle: data.jobTitle,
          company: data.company,
          timestamp: Date.now(),
        },
      };

      if (jobId) {
        storagePayload[`jobid_${jobId}`] = {
          score: result.fit_score,
          shouldApply: result.should_apply,
        };
      }

      chrome.storage.local.set(storagePayload, () => {
        console.log("[JobScout] Score saved, updating badges for job:", jobId);
        if (jobId) {
          updateBadgeForJobId(jobId, result.fit_score, result.should_apply);
        }
      });

      console.log("[JobScout] ===== SCORE RESULT =====");
      console.log(`[JobScout] Fit Score:    ${result.fit_score}/100`);
      console.log(`[JobScout] Should Apply: ${result.should_apply}`);
      console.log(`[JobScout] Verdict:      ${result.one_line_verdict}`);
      console.log("[JobScout] =========================");
    },
  );
}

function waitForDescriptionThenAnalyze(): void {
  console.log("[JobScout] Waiting for job description to render...");
  let attempts = 0;
  const maxAttempts = 20;

  const interval = setInterval(() => {
    attempts++;
    const descriptionEl = document.querySelector<HTMLElement>(
      ".jobs-description__content .jobs-box__html-content",
    );

    if (descriptionEl && descriptionEl.innerText.trim().length > 100) {
      clearInterval(interval);
      console.log("[JobScout] Description ready after", attempts, "attempts");
      analyzeJob();
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn(
        "[JobScout] Description never rendered after",
        maxAttempts,
        "attempts",
      );
    }
  }, 300);
}

function onUrlChange(newUrl: string): void {
  console.log("[JobScout] URL changed to:", newUrl);

  const isJobPage = newUrl.includes("linkedin.com/jobs");
  if (!isJobPage) return;

  const hasJobId =
    newUrl.includes("currentJobId=") || !!newUrl.match(/\/jobs\/view\/\d+/);
  if (!hasJobId) {
    console.log("[JobScout] No specific job selected yet, waiting...");
    return;
  }

  waitForDescriptionThenAnalyze();
}

function initCardObserver(): void {
  console.log("[JobScout] Initializing card observer");

  const processCard = (card: Element): void => {
    if (card.hasAttribute("data-jobscout-processed")) return;
    card.setAttribute("data-jobscout-processed", "true");
    checkAndInjectFromStorage(card);
  };

  const scanCards = (): void => {
    const cards = document.querySelectorAll(
      ".job-card-container, .jobs-search-results__list-item, [data-job-id]",
    );
    cards.forEach(processCard);
  };

  const cardObserver = new MutationObserver(() => {
    scanCards();
  });

  cardObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

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

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log("[JobScout] URL watcher initialized");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRIGGER_REANALYZE") {
    console.log("[JobScout] Re-analyze triggered from popup");
    lastAnalyzedUrl = "";
    analysisInProgress = false;
    waitForDescriptionThenAnalyze();
  }
});

initUrlWatcher();
initCardObserver();
onUrlChange(window.location.href);
