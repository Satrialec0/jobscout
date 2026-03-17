import { ExtractionResult } from "./types";

console.log("[JobScout] Hiring.cafe extractor loaded");

function extractSalary(): string | null {
  const salarySelectors = [
    "[class*='salary']",
    "[class*='compensation']",
    "[class*='pay']",
  ];

  for (const selector of salarySelectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      const text = el.innerText.trim();
      if (
        text.includes("$") ||
        text.toLowerCase().includes("k/yr") ||
        text.toLowerCase().includes("/hr")
      ) {
        console.log("[JobScout Hiring.cafe] Salary found via selector:", text);
        return text.split("\n")[0].trim();
      }
    }
  }

  const bodyText =
    document.querySelector<HTMLElement>(
      "main, [class*='job-description'], [class*='jobDescription']",
    )?.innerText ?? "";
  const salaryRegex =
    /\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:\/yr|\/year|\/hr|\/hour|k\/yr))?/gi;
  const matches = bodyText.match(salaryRegex);
  if (matches && matches.length > 0) {
    console.log("[JobScout Hiring.cafe] Salary found via regex:", matches[0]);
    return matches[0].trim();
  }

  console.log("[JobScout Hiring.cafe] No salary found");
  return null;
}

function extractJobAge(): { text: string; isOld: boolean } | null {
  const allText = document.querySelector<HTMLElement>("main")?.innerText ?? "";
  const ageMatch = allText.match(
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
    console.log(`[JobScout Hiring.cafe] Job age: ${ageText}, isOld: ${isOld}`);
    return { text: ageText, isOld };
  }

  console.log("[JobScout Hiring.cafe] Job age not found");
  return null;
}

function extractJobId(url: string): string | null {
  const segments = url.replace(/\/$/, "").split("/");
  const lastSegment = segments[segments.length - 1];

  if (lastSegment && lastSegment.length > 3 && !lastSegment.includes("=")) {
    return lastSegment;
  }

  const idMatch = url.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];

  const jobMatch = url.match(/\/job(?:s)?\/([^/?]+)/);
  if (jobMatch) return jobMatch[1];

  return null;
}

export function extractHiringCafe(url: string): ExtractionResult {
  console.log("[JobScout Hiring.cafe] Starting extraction");

  const jobTitleEl = document.querySelector<HTMLElement>(
    "h1, [class*='job-title'], [class*='jobTitle'], [class*='position']",
  );

  const companyEl = document.querySelector<HTMLElement>(
    "[class*='company'], [class*='employer'], [class*='organization']",
  );

  const descriptionEl = document.querySelector<HTMLElement>(
    "[class*='description'], [class*='job-body'], [class*='jobBody'], main article",
  );

  if (!jobTitleEl || !companyEl || !descriptionEl) {
    const reason = `Missing elements — title:${!!jobTitleEl} company:${!!companyEl} desc:${!!descriptionEl}`;
    console.warn("[JobScout Hiring.cafe] Extraction failed:", reason);
    return { success: false, reason };
  }

  const jobTitle = jobTitleEl.innerText.trim();
  const company = companyEl.innerText.split("\n")[0].trim();
  const jobDescription = descriptionEl.innerText.trim();

  if (jobDescription.length < 100) {
    const reason = `Description too short: ${jobDescription.length} chars`;
    console.warn("[JobScout Hiring.cafe]", reason);
    return { success: false, reason };
  }

  const jobId = extractJobId(url);
  if (!jobId) {
    const reason = "Could not extract job ID from URL";
    console.warn("[JobScout Hiring.cafe]", reason);
    return { success: false, reason };
  }

  const salary = extractSalary();
  const ageResult = extractJobAge();

  console.log("[JobScout Hiring.cafe] Extraction successful:", {
    jobTitle,
    company,
    jobId,
    descriptionLength: jobDescription.length,
    salary,
    jobAge: ageResult?.text ?? null,
  });

  return {
    success: true,
    data: {
      jobTitle,
      company,
      jobDescription,
      salary,
      easyApply: false,
      jobAge: ageResult?.text ?? null,
      jobAgeIsOld: ageResult?.isOld ?? false,
      jobId,
      url,
    },
  };
}

export function isHiringCafePage(url: string): boolean {
  return url.includes("hiring.cafe");
}

export function extractHiringCafeCardJobId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>("a[href]");
  if (!link) return null;

  const href = link.href;
  const segments = href.replace(/\/$/, "").split("/");
  return segments[segments.length - 1] || null;
}
