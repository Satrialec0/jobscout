import { ExtractionResult } from "./types";

console.log("[JobScout] LinkedIn extractor loaded");

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
        console.log("[JobScout LinkedIn] Salary found via selector:", text);
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
      console.log("[JobScout LinkedIn] Salary found via regex:", matches[0]);
      return matches[0].trim();
    }
  }

  console.log("[JobScout LinkedIn] No salary found");
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
        console.log("[JobScout LinkedIn] Easy Apply detected via selector");
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
        console.log("[JobScout LinkedIn] Easy Apply detected in top card");
        return true;
      }
    }
    console.log("[JobScout LinkedIn] Top card found, no Easy Apply button");
    return false;
  }

  console.log("[JobScout LinkedIn] Could not scope to job panel");
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

    const ageMatch = el.innerText.match(
      /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
    );

    if (ageMatch) {
      const value = parseInt(ageMatch[1]);
      const unit = ageMatch[2].toLowerCase();
      const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;
      const isOld =
        unit === "month" ||
        (unit === "week" && value >= 2) ||
        (unit === "day" && value >= 14);
      console.log(`[JobScout LinkedIn] Job age: ${ageText}, isOld: ${isOld}`);
      return { text: ageText, isOld };
    }
  }

  const containerText =
    document.querySelector<HTMLElement>(
      ".job-details-jobs-unified-top-card__container--two-pane",
    )?.innerText ?? "";

  const fallbackMatch = containerText.match(
    /(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
  );

  if (fallbackMatch) {
    const value = parseInt(fallbackMatch[1]);
    const unit = fallbackMatch[2].toLowerCase();
    const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;
    const isOld =
      unit === "month" ||
      (unit === "week" && value >= 2) ||
      (unit === "day" && value >= 14);
    console.log(
      `[JobScout LinkedIn] Job age via fallback: ${ageText}, isOld: ${isOld}`,
    );
    return { text: ageText, isOld };
  }

  console.log("[JobScout LinkedIn] Job age not found");
  return null;
}

function extractJobId(url: string): string | null {
  const currentJobIdMatch = url.match(/currentJobId=(\d+)/);
  if (currentJobIdMatch) return currentJobIdMatch[1];

  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];

  return null;
}

export function extractLinkedIn(url: string): ExtractionResult {
  console.log("[JobScout LinkedIn] Starting extraction");

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
    const reason = `Missing elements — title:${!!jobTitleEl} company:${!!companyEl} desc:${!!descriptionEl}`;
    console.warn("[JobScout LinkedIn] Extraction failed:", reason);
    return { success: false, reason };
  }

  const jobTitle = jobTitleEl.innerText.trim();
  const company = companyEl.innerText.trim();
  const jobDescription = descriptionEl.innerText.trim();

  if (jobDescription.length < 100) {
    const reason = `Description too short: ${jobDescription.length} chars`;
    console.warn("[JobScout LinkedIn]", reason);
    return { success: false, reason };
  }

  const jobId = extractJobId(url);
  if (!jobId) {
    const reason = "Could not extract job ID from URL";
    console.warn("[JobScout LinkedIn]", reason);
    return { success: false, reason };
  }

  const salary = extractSalary();
  const easyApply = extractEasyApply();
  const ageResult = extractJobAge();

  console.log("[JobScout LinkedIn] Extraction successful:", {
    jobTitle,
    company,
    jobId,
    descriptionLength: jobDescription.length,
    salary,
    easyApply,
    jobAge: ageResult?.text ?? null,
  });

  return {
    success: true,
    data: {
      jobTitle,
      company,
      jobDescription,
      salary,
      easyApply,
      jobAge: ageResult?.text ?? null,
      jobAgeIsOld: ageResult?.isOld ?? false,
      jobId,
      url,
    },
  };
}

export function isLinkedInJobPage(url: string): boolean {
  return (
    url.includes("linkedin.com/jobs") &&
    (url.includes("currentJobId=") || !!url.match(/\/jobs\/view\/\d+/))
  );
}

export function extractLinkedInCardJobId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>(
    "a[href*='currentJobId'], a[href*='/jobs/view/']",
  );
  if (!link) return null;

  const href = link.href;
  const currentJobIdMatch = href.match(/currentJobId=(\d+)/);
  if (currentJobIdMatch) return currentJobIdMatch[1];

  const viewMatch = href.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) return viewMatch[1];

  return null;
}
