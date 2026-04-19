import type { GreenhouseExtraction } from "./greenhouse";

export function isLeverPage(url: string): boolean {
  return url.includes("jobs.lever.co");
}

export function extractLever(): GreenhouseExtraction {
  // Job title
  const titleSelectors = [
    ".posting-name h2",
    ".posting-headline h2",
    "h2.posting-name",
    ".posting-name",
    "h1",
  ];
  let jobTitle = "";
  for (const sel of titleSelectors) {
    const text = document.querySelector<HTMLElement>(sel)?.innerText?.trim();
    if (text && text.length > 2) {
      jobTitle = text;
      break;
    }
  }
  if (!jobTitle) {
    // Page title often: "Job Title - Company"
    jobTitle = document.title.replace(/\s*[-|–].*$/, "").trim();
  }

  // Company from URL: jobs.lever.co/{company}/{id}/...
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const company = (pathParts[0] || "").replace(/-/g, " ");

  // Questions from application form — Lever uses .application-question wrappers
  const questions: GreenhouseExtraction["questions"] = [];
  document.querySelectorAll<HTMLElement>(".application-question").forEach((field) => {
    const labelEl = field.querySelector<HTMLElement>(".application-label, label");
    const label = labelEl?.innerText?.replace(/\s*\*\s*$/, "").trim();
    if (!label || label.length < 2) return;

    if (field.querySelector('input[type="file"]')) return;
    if (field.querySelector('input[type="hidden"]')) return;

    let fieldType: "text" | "textarea" | "select" = "text";
    if (field.querySelector("textarea")) fieldType = "textarea";
    else if (field.querySelector("select")) fieldType = "select";

    questions.push({ label, fieldType });
  });

  return { jobTitle, company, questions };
}
