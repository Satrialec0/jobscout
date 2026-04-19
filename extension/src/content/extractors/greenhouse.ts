export interface GreenhouseQuestion {
  label: string;
  fieldType: "text" | "textarea" | "select";
}

export interface GreenhouseExtraction {
  jobTitle: string;
  company: string;
  questions: GreenhouseQuestion[];
}

export function isGreenhousePage(url: string): boolean {
  return (
    url.includes("boards.greenhouse.io") ||
    url.includes("job-boards.greenhouse.io")
  );
}

function extractJobTitle(): string {
  // Try structured selectors first
  const selectors = [
    "h1.app-title",
    ".app-header h1",
    ".header--title",
    "h1",
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 2) return text;
  }

  // Fall back to page title parsing: "Job Application for {title} at {company}"
  const titleMatch = document.title.match(/^Job Application for (.+?) at .+/i);
  if (titleMatch) return titleMatch[1].trim();

  return document.title.replace(/greenhouse/i, "").trim();
}

function extractCompany(): string {
  // Try structured selectors
  const selectors = [
    ".company-name",
    ".company--name",
    ".header--company",
    "[class*='company']",
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 1) return text;
  }

  // Fall back to page title parsing: "Job Application for {title} at {company}"
  const titleMatch = document.title.match(/^Job Application for .+ at (.+)/i);
  if (titleMatch) return titleMatch[1].trim();

  // Try URL: boards.greenhouse.io/{company}/jobs/{id}
  const urlMatch = window.location.pathname.match(/^\/([^/]+)\/jobs\//);
  if (urlMatch) return urlMatch[1].replace(/-/g, " ").trim();

  return "";
}

function extractQuestions(): GreenhouseQuestion[] {
  const questions: GreenhouseQuestion[] = [];

  // Greenhouse application forms use div.field containing label + input/textarea/select
  document.querySelectorAll<HTMLElement>("div.field").forEach((field) => {
    const labelEl = field.querySelector<HTMLElement>("label");
    const label = labelEl?.innerText
      ?.replace(/\s*\*\s*$/, "")  // strip trailing asterisk (required marker)
      .trim();
    if (!label || label.length < 2) return;

    // Determine field type
    let fieldType: "text" | "textarea" | "select" = "text";
    if (field.querySelector("textarea")) {
      fieldType = "textarea";
    } else if (field.querySelector("select")) {
      fieldType = "select";
    }

    // Skip purely file-upload or checkbox fields (no useful text answer)
    if (field.querySelector('input[type="file"]')) return;
    if (field.querySelector('input[type="checkbox"]') && !field.querySelector('input[type="text"]')) return;

    questions.push({ label, fieldType });
  });

  return questions;
}

export function extractGreenhouse(): GreenhouseExtraction {
  return {
    jobTitle: extractJobTitle(),
    company: extractCompany(),
    questions: extractQuestions(),
  };
}
