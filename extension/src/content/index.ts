console.log("[JobScout] Content script loaded on:", window.location.href);

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
    console.warn(
      "[JobScout] Description too short, not fully rendered yet:",
      jobDescription.length,
    );
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
  if (analysisInProgress) {
    console.log("[JobScout] Analysis already in progress, skipping");
    return;
  }

  const data = extractLinkedInJob();
  if (!data) {
    console.warn("[JobScout] Extraction failed, aborting");
    return;
  }

  analysisInProgress = true;
  console.log("[JobScout] Sending to background worker...");

  chrome.runtime.sendMessage(
    {
      type: "ANALYZE_JOB",
      payload: {
        job_title: data.jobTitle,
        company: data.company,
        job_description: data.jobDescription,
        url: window.location.href,
      },
    },
    (response) => {
      analysisInProgress = false;

      if (chrome.runtime.lastError) {
        console.error(
          "[JobScout] Message error:",
          chrome.runtime.lastError.message,
        );
        return;
      }

      if (!response.success) {
        console.error("[JobScout] Backend error:", response.error);
        return;
      }

      const result: AnalyzeResponse = response.data;

      console.log("[JobScout] ===== SCORE RESULT =====");
      console.log(`[JobScout] Fit Score:    ${result.fit_score}/100`);
      console.log(`[JobScout] Should Apply: ${result.should_apply}`);
      console.log(`[JobScout] Verdict:      ${result.one_line_verdict}`);
      console.log("[JobScout] Direct Matches:", result.direct_matches);
      console.log("[JobScout] Transferable:", result.transferable);
      console.log("[JobScout] Gaps:", result.gaps);
      console.log("[JobScout] Green Flags:", result.green_flags);
      console.log("[JobScout] Red Flags:", result.red_flags);
      console.log("[JobScout] =========================");
    },
  );
}

function waitForJobContent(): void {
  console.log("[JobScout] Waiting for job content to load...");
  let triggered = false;

  const observer = new MutationObserver((_mutations, obs) => {
    if (triggered) return;

    const descriptionEl = document.querySelector<HTMLElement>(
      ".jobs-description__content .jobs-box__html-content",
    );

    if (descriptionEl && descriptionEl.innerText.trim().length > 100) {
      triggered = true;
      obs.disconnect();
      console.log(
        "[JobScout] Job content detected via observer, starting analysis",
      );
      setTimeout(analyzeJob, 800);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  const descriptionEl = document.querySelector<HTMLElement>(
    ".jobs-description__content .jobs-box__html-content",
  );
  if (descriptionEl && descriptionEl.innerText.trim().length > 100) {
    triggered = true;
    observer.disconnect();
    console.log("[JobScout] Job content already present, starting analysis");
    setTimeout(analyzeJob, 800);
  }
}

waitForJobContent();
