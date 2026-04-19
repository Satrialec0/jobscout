import type { GreenhouseExtraction } from "./greenhouse";

export function isAshbyPage(url: string): boolean {
  return url.includes("app.ashbyhq.com");
}

export function extractAshby(): GreenhouseExtraction {
  // Job title — Ashby renders it in an h1 on both listing and application pages
  const titleEl = document.querySelector<HTMLElement>("h1");
  let jobTitle = titleEl?.innerText?.trim() || "";
  if (!jobTitle) {
    // Page title often: "Job Title | Company"
    jobTitle = document.title.replace(/\s*[|–-].*$/, "").trim();
  }

  // Company from URL path: /jobs/{company-slug}/{id}/...
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const jobsIdx = pathParts.indexOf("jobs");
  const slugRaw = jobsIdx !== -1 ? pathParts[jobsIdx + 1] : pathParts[0] || "";
  const company = slugRaw.replace(/-/g, " ");

  // Questions — Ashby uses labeled form fields. Best-effort scrape.
  const questions: GreenhouseExtraction["questions"] = [];
  const seen = new Set<string>();

  document.querySelectorAll<HTMLElement>("label").forEach((labelEl) => {
    const label = labelEl.innerText?.replace(/\s*\*\s*$/, "").trim();
    if (!label || label.length < 2 || seen.has(label)) return;

    // Skip labels that are just UI chrome (e.g., "Resume", "Cover Letter" file upload labels)
    const forId = labelEl.getAttribute("for");
    const inputEl = forId
      ? document.getElementById(forId)
      : labelEl.parentElement?.querySelector("input, textarea, select");

    if (!inputEl) return;
    const inputType = (inputEl as HTMLInputElement).type;
    if (inputType === "file" || inputType === "hidden" || inputType === "checkbox" || inputType === "radio") return;

    seen.add(label);

    let fieldType: "text" | "textarea" | "select" = "text";
    if (inputEl.tagName === "TEXTAREA") fieldType = "textarea";
    else if (inputEl.tagName === "SELECT") fieldType = "select";

    questions.push({ label, fieldType });
  });

  return { jobTitle, company, questions };
}
