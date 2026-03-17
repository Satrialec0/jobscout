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

function extractSalary(): string | null {
  const salarySelectors = [
    ".job-details-jobs-unified-top-card__job-insight--highlight",
    ".job-details-jobs-unified-top-card__salary-info",
    "[class*='salary']",
    ".compensation__salary",
  ];

  for (const selector of salarySelectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      const text = el.innerText.trim();
      if (text.includes("$") || text.toLowerCase().includes("k/yr")) {
        console.log("[JobScout] Salary found via selector:", text);
        return text.split("\n")[0].trim();
      }
    }
  }

  const descriptionEl = document.querySelector<HTMLElement>(
    ".jobs-description__content .jobs-box__html-content",
  );
  if (descriptionEl) {
    const text = descriptionEl.innerText;
    const salaryRegex =
      /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:\/yr|\/year|\/hr|\/hour|k\/yr|,000\/yr))?/gi;
    const matches = text.match(salaryRegex);
    if (matches && matches.length > 0) {
      console.log("[JobScout] Salary found via regex:", matches[0]);
      return matches[0].trim();
    }
  }

  console.log("[JobScout] No salary found");
  return null;
}

function extractEasyApply(): boolean {
  const jobDetailPanel = document.querySelector<HTMLElement>(
    ".jobs-search__job-details--wrapper, .job-view-layout, .jobs-details",
  );

  const searchScope = jobDetailPanel ?? document;

  const specificSelectors = [
    "button[aria-label*='Easy Apply']",
    ".jobs-apply-button--top-card",
    ".jobs-apply-button[aria-label*='Easy Apply']",
    ".artdeco-button[aria-label*='Easy Apply']",
  ];

  for (const selector of specificSelectors) {
    const el = searchScope.querySelector(selector);
    if (el) {
      const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
      if (label.toLowerCase().includes("easy apply")) {
        console.log("[JobScout] Easy Apply detected via selector in job panel");
        return true;
      }
    }
  }

  const topCardPanel = document.querySelector(
    ".job-details-jobs-unified-top-card__container--two-pane, .jobs-unified-top-card",
  );

  if (topCardPanel) {
    const buttons = topCardPanel.querySelectorAll("button");
    for (const btn of buttons) {
      const label = btn.getAttribute("aria-label") ?? btn.textContent ?? "";
      if (label.toLowerCase().includes("easy apply")) {
        console.log("[JobScout] Easy Apply detected in top card panel");
        return true;
      }
    }
    console.log("[JobScout] Top card panel found but no Easy Apply button");
    return false;
  }

  console.log(
    "[JobScout] Could not scope to job panel, Easy Apply not detected",
  );
  return false;
}

function extractJobAge(): { text: string; isOld: boolean } | null {
  const ageSelectors = [
    ".job-details-jobs-unified-top-card__primary-description-without-tagline",
    ".job-details-jobs-unified-top-card__primary-description",
    ".jobs-unified-top-card__subtitle-primary-grouping",
    "[class*='posted-date']",
    "[class*='job-age']",
  ];

  for (const selector of ageSelectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;

    const text = el.innerText;
    const ageMatch = text.match(
      /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
    );

    if (ageMatch) {
      const value = parseInt(ageMatch[1]);
      const unit = ageMatch[2].toLowerCase();
      const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;

      let isOld = false;
      if (unit === "month") isOld = true;
      if (unit === "week" && value >= 2) isOld = true;
      if (unit === "day" && value >= 14) isOld = true;

      console.log(`[JobScout] Job age: ${ageText}, isOld: ${isOld}`);
      return { text: ageText, isOld };
    }
  }

  const allText =
    document.querySelector<HTMLElement>(
      ".job-details-jobs-unified-top-card__container--two-pane",
    )?.innerText ?? "";

  const fallbackMatch = allText.match(
    /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
  );

  if (fallbackMatch) {
    const value = parseInt(fallbackMatch[1]);
    const unit = fallbackMatch[2].toLowerCase();
    const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;

    let isOld = false;
    if (unit === "month") isOld = true;
    if (unit === "week" && value >= 2) isOld = true;
    if (unit === "day" && value >= 14) isOld = true;

    console.log(`[JobScout] Job age via fallback: ${ageText}, isOld: ${isOld}`);
    return { text: ageText, isOld };
  }

  console.log("[JobScout] Job age not found");
  return null;
}

function extractLinkedInJob(): {
  jobTitle: string;
  company: string;
  jobDescription: string;
  salary: string | null;
  easyApply: boolean;
  jobAge: string | null;
  jobAgeIsOld: boolean;
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

  const salary = extractSalary();
  const easyApply = extractEasyApply();
  const ageResult = extractJobAge();

  console.log("[JobScout] Extracted:", {
    jobTitle,
    company,
    descriptionLength: jobDescription.length,
    salary,
    easyApply,
    jobAge: ageResult?.text ?? null,
    jobAgeIsOld: ageResult?.isOld ?? false,
  });

  return {
    jobTitle,
    company,
    jobDescription,
    salary,
    easyApply,
    jobAge: ageResult?.text ?? null,
    jobAgeIsOld: ageResult?.isOld ?? false,
  };
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

      const jobIdMatch = currentUrl.match(/currentJobId=(\d+)/);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;

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

      if (jobId) {
        storagePayload[`jobid_${jobId}`] = {
          score: result.fit_score,
          shouldApply: result.should_apply,
          verdict: result.one_line_verdict,
        };
      }

      chrome.storage.local.set(storagePayload, () => {
        console.log("[JobScout] Score saved, updating badges for job:", jobId);
        if (jobId) {
          updateBadgeForJobId(
            jobId,
            result.fit_score,
            result.should_apply,
            result.one_line_verdict,
          );
        }
      });

      console.log("[JobScout] ===== SCORE RESULT =====");
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
