import { ExtractionResult } from "./types";

console.log("[JobScout] Indeed extractor loaded");

function extractSalary(): string | null {
  const salarySelectors = [
    "[class*='salary']",
    "[data-testid='attribute_snippet_testid']",
    ".js-match-insights-provider-hardcoded-content",
    "#salaryInfoAndJobType",
  ];

  for (const selector of salarySelectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      const text = el.innerText.trim();
      if (
        text.includes("$") ||
        text.toLowerCase().includes("per hour") ||
        text.toLowerCase().includes("per year")
      ) {
        console.log("[JobScout Indeed] Salary found via selector:", text);
        return text.split("\n")[0].trim();
      }
    }
  }

  const descriptionEl = document.querySelector<HTMLElement>(
    "#jobDescriptionText, .jobsearch-jobDescriptionText",
  );
  if (descriptionEl) {
    const text = descriptionEl.innerText;
    const salaryRegex =
      /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:\/yr|\/year|\/hr|\/hour|per hour|per year|k\/yr))?/gi;
    const matches = text.match(salaryRegex);
    if (matches && matches.length > 0) {
      console.log("[JobScout Indeed] Salary found via regex:", matches[0]);
      return matches[0].trim();
    }
  }

  console.log("[JobScout Indeed] No salary found");
  return null;
}

function extractEasyApply(): boolean {
  const applyButton = document.querySelector<HTMLElement>(
    "[id*='indeedApplyButton'], [class*='indeed-apply'], [data-indeed-apply]",
  );

  if (applyButton) {
    console.log("[JobScout Indeed] Indeed Easy Apply detected");
    return true;
  }

  console.log("[JobScout Indeed] No Indeed Easy Apply detected");
  return false;
}

function extractJobAge(): { text: string; isOld: boolean } | null {
  const ageSelectors = [
    "[class*='date']",
    "[data-testid='myJobsStateDate']",
    ".jobsearch-HiringInsights-entry--bullet",
  ];

  for (const selector of ageSelectors) {
    const elements = document.querySelectorAll<HTMLElement>(selector);
    for (const el of elements) {
      const text = el.innerText;
      const ageMatch = text.match(
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
        console.log(`[JobScout Indeed] Job age: ${ageText}, isOld: ${isOld}`);
        return { text: ageText, isOld };
      }

      if (
        text.toLowerCase().includes("today") ||
        text.toLowerCase().includes("just posted")
      ) {
        console.log("[JobScout Indeed] Job posted today");
        return { text: "today", isOld: false };
      }

      if (text.toLowerCase().includes("active")) {
        console.log("[JobScout Indeed] Job recently active");
        return { text: "recently active", isOld: false };
      }
    }
  }

  console.log("[JobScout Indeed] Job age not found");
  return null;
}

function extractJobId(url: string): string | null {
  const jkMatch = url.match(/[?&]jk=([a-zA-Z0-9]+)/);
  if (jkMatch) return jkMatch[1];

  const vjkMatch = url.match(/[?&]vjk=([a-zA-Z0-9]+)/);
  if (vjkMatch) return vjkMatch[1];

  return null;
}

export function extractIndeed(url: string): ExtractionResult {
  console.log("[JobScout Indeed] Starting extraction");

  const jobTitleEl = document.querySelector<HTMLElement>(
    "[class*='jobsearch-JobInfoHeader-title'], h1[class*='jobTitle'], .jobsearch-JobInfoHeader-title",
  );

  const companyEl = document.querySelector<HTMLElement>(
    "[data-company-name='true'], [class*='companyName'], .jobsearch-InlineCompanyRating-companyHeader",
  );

  const descriptionEl = document.querySelector<HTMLElement>(
    "#jobDescriptionText, .jobsearch-jobDescriptionText",
  );

  if (!jobTitleEl || !companyEl || !descriptionEl) {
    const reason = `Missing elements — title:${!!jobTitleEl} company:${!!companyEl} desc:${!!descriptionEl}`;
    console.warn("[JobScout Indeed] Extraction failed:", reason);
    return { success: false, reason };
  }

  const jobTitle = jobTitleEl.innerText.trim();
  const company = companyEl.innerText.trim();
  const jobDescription = descriptionEl.innerText.trim();

  if (jobDescription.length < 100) {
    const reason = `Description too short: ${jobDescription.length} chars`;
    console.warn("[JobScout Indeed]", reason);
    return { success: false, reason };
  }

  const jobId = extractJobId(url);
  if (!jobId) {
    const reason = "Could not extract job ID from URL";
    console.warn("[JobScout Indeed]", reason);
    return { success: false, reason };
  }

  const salary = extractSalary();
  const easyApply = extractEasyApply();
  const ageResult = extractJobAge();

  console.log("[JobScout Indeed] Extraction successful:", {
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

export function isIndeedJobPage(url: string): boolean {
  return url.includes("indeed.com/viewjob") || url.includes("indeed.com/job/");
}

export function extractIndeedCardJobId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>(
    "a[href*='jk='], a[href*='/viewjob']",
  );
  if (!link) return null;

  const jkMatch = link.href.match(/[?&]jk=([a-zA-Z0-9]+)/);
  if (jkMatch) return jkMatch[1];

  const dataJobId =
    card.getAttribute("data-jk") ?? card.getAttribute("data-job-id");
  if (dataJobId) return dataJobId;

  return null;
}
