import { ExtractionResult } from "./types";

console.log("[JobScout] Hiring.cafe extractor loaded");

function extractJobId(modal: HTMLElement): string | null {
  const companyLink = modal.querySelector<HTMLAnchorElement>(
    "a[href*='company=']",
  );
  if (companyLink) {
    const match = companyLink.href.match(/company=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1])
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 24);
    }
  }

  const title = modal
    .querySelector<HTMLElement>(
      "h2.font-extrabold, h2[class*='font-extrabold'], h1",
    )
    ?.innerText?.trim();

  if (title) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = (hash << 5) - hash + title.charCodeAt(i);
      hash |= 0;
    }
    return `hc_${Math.abs(hash).toString(16)}`;
  }

  return null;
}

function extractCompany(modal: HTMLElement): string | null {
  const companySpan = modal.querySelector<HTMLElement>(
    "span.text-xl, span[class*='text-xl'][class*='font-semibold'], span[class*='font-semibold'][class*='text-gray']",
  );

  if (companySpan) {
    const text = companySpan.innerText.trim().replace(/^@\s*/, "").trim();
    if (
      text.length > 1 &&
      text.length < 80 &&
      !text.includes("$") &&
      !text.match(/^\d/)
    ) {
      console.log("[JobScout Hiring.cafe] Company found via span:", text);
      return text;
    }
  }

  const companyLink = modal.querySelector<HTMLAnchorElement>(
    "a[href*='company=']",
  );
  if (companyLink) {
    try {
      const match = companyLink.href.match(/company=([^&]+)/);
      if (match) {
        const decoded = decodeURIComponent(match[1]);
        const parts = decoded.split("___");
        if (parts.length >= 3) {
          const name = parts[2].replace(/_/g, " ").trim();
          console.log("[JobScout Hiring.cafe] Company found via link:", name);
          return name;
        }
      }
    } catch {
      // fall through
    }
  }

  console.log("[JobScout Hiring.cafe] Company not found");
  return null;
}

function extractSalary(modal: HTMLElement): string | null {
  const tagEls = modal.querySelectorAll<HTMLElement>(
    "span[class*='rounded'][class*='border'][class*='text-xs']",
  );

  for (const el of tagEls) {
    const text = el.innerText.trim();
    if (
      text.includes("$") ||
      text.toLowerCase().includes("k/yr") ||
      text.toLowerCase().includes("/hr")
    ) {
      console.log("[JobScout Hiring.cafe] Salary found:", text);
      return text;
    }
  }

  const allEls = modal.querySelectorAll<HTMLElement>("*");
  for (const el of allEls) {
    if (el.children.length > 0) continue;
    const text = el.innerText?.trim() ?? "";
    if (
      text.includes("$") &&
      (text.includes("k") ||
        text.includes("/yr") ||
        text.includes("/hr") ||
        text.includes("year") ||
        text.includes("hour")) &&
      text.length < 40
    ) {
      console.log("[JobScout Hiring.cafe] Salary found via scan:", text);
      return text;
    }
  }

  console.log("[JobScout Hiring.cafe] No salary found");
  return null;
}

function extractJobAge(
  modal: HTMLElement,
): { text: string; isOld: boolean } | null {
  const ageEl = modal.querySelector<HTMLElement>(
    "span[class*='text-cyan'][class*='font-bold'], span[class*='cyan'][class*='bold']",
  );

  if (ageEl) {
    const text = ageEl.innerText.trim();
    const postedMatch = text.match(
      /Posted\s+(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
    );
    if (postedMatch) {
      const value = parseInt(postedMatch[1]);
      const unit = postedMatch[2].toLowerCase();
      const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;
      const isOld =
        unit === "month" ||
        (unit === "week" && value >= 2) ||
        (unit === "day" && value >= 14);
      console.log(
        `[JobScout Hiring.cafe] Job age: ${ageText}, isOld: ${isOld}`,
      );
      return { text: ageText, isOld };
    }
  }

  const allEls = modal.querySelectorAll<HTMLElement>("*");
  for (const el of allEls) {
    if (el.children.length > 0) continue;
    const text = el.innerText?.trim() ?? "";
    const postedMatch = text.match(
      /Posted\s+(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i,
    );
    if (postedMatch) {
      const value = parseInt(postedMatch[1]);
      const unit = postedMatch[2].toLowerCase();
      const ageText = `${value} ${unit}${value !== 1 ? "s" : ""} ago`;
      const isOld =
        unit === "month" ||
        (unit === "week" && value >= 2) ||
        (unit === "day" && value >= 14);
      console.log(
        `[JobScout Hiring.cafe] Job age: ${ageText}, isOld: ${isOld}`,
      );
      return { text: ageText, isOld };
    }
  }

  console.log("[JobScout Hiring.cafe] Job age not found");
  return null;
}

function extractDescription(modal: HTMLElement): string | null {
  const article = modal.querySelector<HTMLElement>(
    "article.prose, article[class*='prose']",
  );
  if (article && article.innerText.trim().length > 100) {
    console.log(
      "[JobScout Hiring.cafe] Description found via article:",
      article.innerText.trim().length,
      "chars",
    );
    return article.innerText.trim();
  }

  const allEls = Array.from(modal.querySelectorAll<HTMLElement>("*"));
  const descHeading = allEls.find(
    (el) =>
      el.children.length === 0 && el.innerText.trim() === "Job Description",
  );

  if (descHeading) {
    let sibling = descHeading.parentElement
      ?.nextElementSibling as HTMLElement | null;
    while (sibling) {
      const text = sibling.innerText?.trim() ?? "";
      if (text.length > 100) {
        console.log(
          "[JobScout Hiring.cafe] Description found via heading sibling:",
          text.length,
          "chars",
        );
        return text;
      }
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
  }

  const fullText = modal.innerText.trim();
  const descIndex = fullText.indexOf("Job Description");
  if (descIndex !== -1) {
    const trimmed = fullText
      .substring(descIndex + "Job Description".length)
      .trim();
    if (trimmed.length > 100) {
      console.log(
        "[JobScout Hiring.cafe] Description found via text slice:",
        trimmed.length,
        "chars",
      );
      return trimmed;
    }
  }

  console.log("[JobScout Hiring.cafe] Description not found");
  return null;
}

export function extractHiringCafe(url: string): ExtractionResult {
  console.log("[JobScout Hiring.cafe] Starting extraction");

  const modal = document.querySelector<HTMLElement>(".chakra-modal__body");
  if (!modal) {
    console.warn("[JobScout Hiring.cafe] No modal found");
    return { success: false, reason: "No job modal open" };
  }

  const titleEl = modal.querySelector<HTMLElement>(
    "h2.font-extrabold, h2[class*='font-extrabold'], h1",
  );
  const jobTitle = titleEl?.innerText?.trim() ?? "";

  if (!jobTitle) {
    return { success: false, reason: "Missing job title" };
  }

  const company = extractCompany(modal);
  if (!company) {
    console.warn("[JobScout Hiring.cafe] Could not extract company");
    return { success: false, reason: "Missing company" };
  }

  const jobDescription = extractDescription(modal);
  if (!jobDescription || jobDescription.length < 100) {
    return {
      success: false,
      reason: `Description too short or missing: ${jobDescription?.length ?? 0}`,
    };
  }

  const jobId = extractJobId(modal);
  if (!jobId) {
    return { success: false, reason: "Could not generate job ID" };
  }

  const salary = extractSalary(modal);
  const ageResult = extractJobAge(modal);

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

  const segments = link.href.replace(/\/$/, "").split("/");
  const last = segments[segments.length - 1];
  if (last && last.length > 3 && !last.includes("=") && !last.includes(".")) {
    return last;
  }

  return null;
}
