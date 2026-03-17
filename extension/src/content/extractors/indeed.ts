import { ExtractionResult } from "./types";

console.log("[JobScout] Indeed extractor loaded");

function cleanJobTitle(raw: string): string {
  return raw
    .replace(/\n.*$/, "")
    .replace(/\s*-\s*job post\s*$/i, "")
    .replace(/\s*-\s*new\s*$/i, "")
    .trim();
}

function extractJobId(url: string): string | null {
  const vjkMatch = url.match(/[?&]vjk=([a-zA-Z0-9]+)/);
  if (vjkMatch) return vjkMatch[1];

  const jkMatch = url.match(/[?&]jk=([a-zA-Z0-9]+)/);
  if (jkMatch) return jkMatch[1];

  return null;
}

function extractSalary(jobId: string): string | null {
  const panel = document.querySelector<HTMLElement>(
    "#jobsearch-ViewjobPaneWrapper",
  );
  if (!panel) return null;

  const salaryEl = panel.querySelector<HTMLElement>(
    "#salaryInfoAndJobType span, [class*='1oc7tea'], [class*='salary']",
  );

  if (salaryEl) {
    const text = salaryEl.innerText.trim();
    if (text.includes("$")) {
      console.log("[JobScout Indeed] Salary found in panel:", text);
      return text.split("\n")[0].trim();
    }
  }

  const matchInsightsEl = panel.querySelector<HTMLElement>(
    "[class*='js-match-insights'] [class*='e1wnkr790'], [class*='match-insights'] span",
  );
  if (matchInsightsEl) {
    const text = matchInsightsEl.innerText.trim();
    if (text.includes("$")) {
      console.log("[JobScout Indeed] Salary found via match insights:", text);
      return text;
    }
  }

  console.log("[JobScout Indeed] No salary found");
  return null;
}

function extractEasyApply(): boolean {
  const indeedApply = document.querySelector(
    "[class*='IndeedApply'], [data-indeed-apply-jobid], [id*='indeedApplyButton']",
  );
  if (indeedApply) {
    console.log("[JobScout Indeed] Indeed Apply widget detected");
    return true;
  }
  console.log("[JobScout Indeed] No Easy Apply detected");
  return false;
}

function extractJobAge(): { text: string; isOld: boolean } | null {
  const panel = document.querySelector<HTMLElement>(
    "#jobsearch-ViewjobPaneWrapper",
  );
  if (!panel) return null;

  const allEls = panel.querySelectorAll<HTMLElement>("*");
  for (const el of allEls) {
    if (el.children.length > 0) continue;
    const text = el.innerText?.trim() ?? "";

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
      text.toLowerCase() === "today" ||
      text.toLowerCase().includes("just posted")
    ) {
      return { text: "today", isOld: false };
    }
  }

  console.log("[JobScout Indeed] Job age not found");
  return null;
}

export function extractIndeed(url: string): ExtractionResult {
  console.log("[JobScout Indeed] Starting extraction");

  const jobId = extractJobId(url);
  if (!jobId) {
    return { success: false, reason: "Could not extract job ID from URL" };
  }

  const titleEl = document.getElementById(`jobTitle-${jobId}`);
  const jobTitleRaw = titleEl?.innerText ?? "";
  const jobTitle = cleanJobTitle(jobTitleRaw);

  const panel = document.querySelector<HTMLElement>(
    "#jobsearch-ViewjobPaneWrapper",
  );

  const companyEl = panel?.querySelector<HTMLElement>(
    "[data-company-name='true'], [class*='companyName'] a, [class*='companyName'] span, [class*='19eicqx']",
  );
  const company = companyEl?.innerText.split("\n")[0].trim() ?? "";

  const descriptionEl = document.querySelector<HTMLElement>(
    "#jobDescriptionText, .jobsearch-jobDescriptionText",
  );

  if (!jobTitle) {
    console.warn(
      "[JobScout Indeed] Extraction failed: Missing job title for jobId:",
      jobId,
    );
    return {
      success: false,
      reason: `No title element found for jobId: ${jobId}`,
    };
  }

  if (!company) {
    console.warn("[JobScout Indeed] Extraction failed: Missing company");
    return { success: false, reason: "Missing company element" };
  }

  if (!descriptionEl) {
    console.warn("[JobScout Indeed] Extraction failed: Missing description");
    return { success: false, reason: "Missing description element" };
  }

  const jobDescription = descriptionEl.innerText.trim();

  if (jobDescription.length < 100) {
    return {
      success: false,
      reason: `Description too short: ${jobDescription.length} chars`,
    };
  }

  const salary = extractSalary(jobId);
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
  if (!url.includes("indeed.com")) return false;
  return (
    url.includes("vjk=") ||
    url.includes("jk=") ||
    url.includes("/viewjob") ||
    url.includes("/job/")
  );
}

export function extractIndeedCardJobId(card: Element): string | null {
  const idMatch = card.id?.match(/^sj_([a-zA-Z0-9]+)$/);
  if (idMatch) return idMatch[1];

  if (card.tagName === "A") {
    const href = (card as HTMLAnchorElement).href;
    const vjkMatch = href.match(/[?&]vjk=([a-zA-Z0-9]+)/);
    if (vjkMatch) return vjkMatch[1];
    const jkMatch = href.match(/[?&]jk=([a-zA-Z0-9]+)/);
    if (jkMatch) return jkMatch[1];
  }

  const link = card.querySelector<HTMLAnchorElement>("a[id^='sj_']");
  if (link) {
    const idMatch2 = link.id.match(/^sj_([a-zA-Z0-9]+)$/);
    if (idMatch2) return idMatch2[1];
  }

  return null;
}
