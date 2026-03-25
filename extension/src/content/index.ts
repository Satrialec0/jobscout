console.log("[JobScout] Content script loaded on:", window.location.href);

import { checkAndInjectFromStorage, updateBadgeForJobId } from "./badge";
import { addJobToOverlay, updateOverlayActiveJob } from "./overlay";
import {
  extractLinkedIn,
  isLinkedInJobPage,
  extractLinkedInCardJobId,
} from "./extractors/linkedin";
import {
  extractIndeed,
  isIndeedJobPage,
  extractIndeedCardJobId,
} from "./extractors/indeed";
import { extractHiringCafe, isHiringCafePage } from "./extractors/hiring-cafe";
import { JobExtraction } from "./extractors/types";

interface SalaryEstimate {
  low: number;
  high: number;
  currency: string;
  per: string;
  confidence: string;
  assessment: string | null;
}

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
  salary_estimate?: SalaryEstimate;
}

let analysisInProgress = false;
let lastAnalyzedJobId = "";

function detectSite(url: string): "linkedin" | "indeed" | "hiring-cafe" | null {
  if (isLinkedInJobPage(url)) return "linkedin";
  if (isIndeedJobPage(url)) return "indeed";
  if (isHiringCafePage(url)) return "hiring-cafe";
  return null;
}

const BAD_FIT_KEYWORDS = [
  "sales representative",
  "recruiter",
  "truck driver",
  "diesel mechanic",
  "retail associate",
  "customer service representative",
  "customer success",
  "customer service",
  "retail",
  "driver",
  "technician",
  "diesel",
  "mechanic",
  "hvac",
  "plumber",
  "carpenter",
  "welder",
];

function shouldKeywordDim(title: string): boolean {
  const lower = title.toLowerCase();
  return BAD_FIT_KEYWORDS.some((kw) => lower.includes(kw));
}

// ===== ADAPTIVE KEYWORD LEARNING =====

const MIN_HIDE_SAMPLES = 3;
const DIM_CONFIDENCE_THRESHOLD = 0.7;

const NGRAM_STOPWORDS = new Set([
  // Seniority — too generic, appear in good and bad roles
  "senior",
  "junior",
  "associate",
  "principal",
  "staff",
  "lead",
  "head",
  "director",
  "vp",
  "manager",
  "executive",
  // Generic role words
  "engineer",
  "engineering",
  "specialist",
  "analyst",
  "coordinator",
  "consultant",
  "advisor",
  "officer",
  "administrator",
  // Location/time words
  "remote",
  "hybrid",
  "onsite",
  "part",
  "full",
  "time",
  "contract",
  // Common filler
  "and",
  "the",
  "for",
  "with",
  "this",
  "that",
  "from",
  "new",
  "job",
]);

function extractNgrams(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NGRAM_STOPWORDS.has(w));

  const ngrams: string[] = [...words]; // unigrams
  for (let i = 0; i < words.length - 1; i++) {
    // Only include bigrams where neither word is a stopword
    ngrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return ngrams;
}

function reEvaluateAllCards(): void {
  const site = detectSite(window.location.href);
  if (!site) return;

  const cardSelectors: Record<string, string> = {
    linkedin:
      ".job-card-container, .jobs-search-results__list-item, [data-job-id]",
    indeed: "[id^='sj_'], .job_seen_beacon, .resultContent",
    "hiring-cafe": "div.relative.bg-white.rounded-xl",
  };

  document.querySelectorAll(cardSelectors[site]).forEach((card) => {
    const jobId = getCardJobId(card);
    if (!jobId) return;

    const titleEl = card.querySelector<HTMLElement>(
      "span[class*='font-bold'][class*='line-clamp'], .job-card-list__title, .jobTitle",
    );
    const cardTitle = titleEl?.innerText?.trim() ?? "";
    if (!cardTitle) return;

    // Only re-evaluate cards with no user override
    const undimKey = `user_undimmed_${jobId}`;
    const dimKey = `user_dimmed_${jobId}`;
    chrome.storage.local.get([undimKey, dimKey], (data) => {
      if (data[undimKey] || data[dimKey]) return; // User override — skip
      applyVisibility(card, jobId, undefined, cardTitle);
    });
  });
}

function recordHideSignals(title: string): void {
  const ngrams = extractNgrams(title);
  if (ngrams.length === 0) return;

  const hideKeys = ngrams.map((ng) => `kw_hide_${ng}`);
  const showKeys = ngrams.map((ng) => `kw_show_${ng}`);

  chrome.storage.local.get([...hideKeys, ...showKeys], (data) => {
    const updates: Record<string, number> = {};
    let thresholdCrossed = false;

    hideKeys.forEach((key, i) => {
      const newCount = ((data[key] as number) ?? 0) + 1;
      updates[key] = newCount;
      const ng = ngrams[i];
      const showCount = (data[`kw_show_${ng}`] as number) ?? 0;
      const total = newCount + showCount;
      const confidence = newCount / total;
      if (
        newCount >= MIN_HIDE_SAMPLES &&
        confidence >= DIM_CONFIDENCE_THRESHOLD
      ) {
        thresholdCrossed = true;
        console.log(
          `[JobScout] Threshold crossed for: "${ng}" (${newCount}H/${showCount}S)`,
        );
      }
    });

    chrome.storage.local.set(updates, () => {
      console.log(
        "[JobScout] Recorded hide signals for:",
        title.substring(0, 40),
      );
      if (thresholdCrossed) {
        // Re-evaluate all visible cards immediately
        reEvaluateAllCards();
      }
    });
  });
}

function recordShowSignals(title: string): void {
  const ngrams = extractNgrams(title);
  if (ngrams.length === 0) return;

  const keys = ngrams.map((ng) => `kw_show_${ng}`);
  chrome.storage.local.get(keys, (data) => {
    const updates: Record<string, number> = {};
    keys.forEach((key) => {
      updates[key] = ((data[key] as number) ?? 0) + 1;
    });
    chrome.storage.local.set(updates);
    console.log(
      "[JobScout] Recorded show signals for:",
      title.substring(0, 40),
    );
  });
}

function shouldLearnedKeywordDim(
  title: string,
  callback: (dim: boolean) => void,
): void {
  const ngrams = extractNgrams(title);
  if (ngrams.length === 0) {
    callback(false);
    return;
  }

  const hideKeys = ngrams.map((ng) => `kw_hide_${ng}`);
  const showKeys = ngrams.map((ng) => `kw_show_${ng}`);

  chrome.storage.local.get([...hideKeys, ...showKeys], (data) => {
    for (const ng of ngrams) {
      const hideCount = (data[`kw_hide_${ng}`] as number) ?? 0;
      const showCount = (data[`kw_show_${ng}`] as number) ?? 0;
      const total = hideCount + showCount;
      if (hideCount >= MIN_HIDE_SAMPLES && total > 0) {
        const confidence = hideCount / total;
        if (confidence >= DIM_CONFIDENCE_THRESHOLD) {
          console.log(
            `[JobScout] Learned dim: "${ng}" (${hideCount}H/${showCount}S = ${Math.round(confidence * 100)}%)`,
          );
          callback(true);
          return;
        }
      }
    }
    callback(false);
  });
}

function dimCard(card: Element): void {
  (card as HTMLElement).style.opacity = "0.35";
  (card as HTMLElement).style.transition = "opacity 0.2s ease";
}

function undimCard(card: Element): void {
  (card as HTMLElement).style.opacity = "";
}

function getCardJobId(card: Element): string | null {
  return (
    card.getAttribute("data-jobscout-hc-id") ||
    card.getAttribute("data-job-id") ||
    extractCardJobId(card, window.location.href)
  );
}

function injectVisibilityButton(card: Element, isDimmed: boolean): void {
  const existingBtn = card.querySelector("[data-jobscout-vis-btn]");
  if (existingBtn) existingBtn.remove();

  const jobId = getCardJobId(card);
  if (!jobId) return;

  // Find badge target — next to badge for HC, or title area for LI/Indeed
  // For HC cards inject into the native action bar so it's above the click overlay
  // HC bottom row — always visible, contains carousel arrows and action buttons
  const hcActionBar = card.querySelector<HTMLElement>(
    "div.flex.mb-4, div.flex.items-center.space-x-4, div[class*='flex'][class*='space-x-4'][class*='items-center']",
  );

  const badgeTarget =
    hcActionBar ??
    card.querySelector<HTMLElement>("[data-jobscout-badge]")?.parentElement ??
    card.querySelector<HTMLElement>("div.mt-1") ??
    card.querySelector<HTMLElement>(".job-card-list__title") ??
    card.querySelector<HTMLElement>(".jobTitle") ??
    card.querySelector<HTMLElement>("h2.jobTitle") ??
    card.querySelector<HTMLElement>(".job-card-container__link");
  if (!badgeTarget) return;

  const btn = document.createElement("span");
  btn.setAttribute("data-jobscout-vis-btn", jobId);
  btn.style.cssText = `
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    margin-left: 4px;
    vertical-align: middle;
    cursor: pointer;
    background: #1e293b;
    color: #64748b;
    border: 1px solid #334155;
    user-select: none;
    position: relative;
    z-index: 10000;
    pointer-events: all;
  `;
  btn.textContent = isDimmed ? "👁 Show" : "👁 Hide";
  btn.title = isDimmed ? "Show this card" : "Hide this card";

  btn.addEventListener("mouseenter", () => {
    btn.style.color = "#94a3b8";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.color = "#64748b";
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Guard against extension context invalidation
    try {
      if (!chrome.runtime?.id) {
        console.warn(
          "[JobScout] Extension context invalidated — reload the page",
        );
        return;
      }
    } catch {
      console.warn(
        "[JobScout] Extension context invalidated — reload the page",
      );
      return;
    }

    // Extract title for signal recording
    const titleEl = card.querySelector<HTMLElement>(
      "span[class*='font-bold'][class*='line-clamp'], .job-card-list__title, .jobTitle",
    );
    const cardTitle = titleEl?.innerText?.trim() ?? "";

    if (isDimmed) {
      // User wants to show — un-dim, save override, record show signal
      undimCard(card);
      chrome.storage.local.set({ [`user_undimmed_${jobId}`]: true });
      chrome.storage.local.remove(`user_dimmed_${jobId}`);
      if (cardTitle) recordShowSignals(cardTitle);
      injectVisibilityButton(card, false);
    } else {
      // User wants to hide — dim, save override, record hide signal
      dimCard(card);
      const companyEl = card.querySelector<HTMLElement>(
        "span.font-bold:not([class*='line-clamp']), .job-card-list__entity-lockup__company-name, .companyName",
      );
      const cardCompany = companyEl?.innerText?.trim() ?? "";
      chrome.storage.local.set({
        [`user_dimmed_${jobId}`]: { title: cardTitle, company: cardCompany },
      });
      chrome.storage.local.remove(`user_undimmed_${jobId}`);
      if (cardTitle) recordHideSignals(cardTitle);
      injectVisibilityButton(card, true);
    }
  });

  badgeTarget.appendChild(btn);
}

function applyVisibility(
  card: Element,
  jobId: string,
  score?: number,
  title?: string,
): void {
  const undimKey = `user_undimmed_${jobId}`;
  const dimKey = `user_dimmed_${jobId}`;

  chrome.storage.local.get([undimKey, dimKey], (data) => {
    if (data[undimKey]) {
      // User explicitly showed this card — always show
      undimCard(card);
      injectVisibilityButton(card, false);
      return;
    }
    if (data[dimKey]) {
      // User explicitly hid this card — always hide
      dimCard(card);
      injectVisibilityButton(card, true);
      return;
    }

    // No user override — apply automatic rules
    const keywordDim = title ? shouldKeywordDim(title) : false;
    const scoreDim = score !== undefined && score < 30;

    if (keywordDim || scoreDim) {
      dimCard(card);
      injectVisibilityButton(card, true);
      return;
    }

    // Check learned keywords — async
    if (title) {
      shouldLearnedKeywordDim(title, (learnedDim) => {
        if (learnedDim) {
          dimCard(card);
          injectVisibilityButton(card, true);
        } else {
          undimCard(card);
          injectVisibilityButton(card, false);
        }
      });
    } else {
      undimCard(card);
      injectVisibilityButton(card, false);
    }
  });
}

function extractCurrentJob(url: string): JobExtraction | null {
  const site = detectSite(url);
  if (!site) {
    console.log("[JobScout] Not a supported job page:", url);
    return null;
  }

  console.log(`[JobScout] Detected site: ${site}`);

  let result;
  if (site === "linkedin") result = extractLinkedIn(url);
  else if (site === "indeed") result = extractIndeed(url);
  else result = extractHiringCafe(url);

  if (!result.success || !result.data) {
    console.warn("[JobScout] Extraction failed:", result.reason);
    return null;
  }

  return result.data;
}

function extractCardJobId(card: Element, url: string): string | null {
  const site = detectSite(url);
  if (site === "linkedin") return extractLinkedInCardJobId(card);
  if (site === "indeed") return extractIndeedCardJobId(card);
  return null;
}

async function analyzeJob(forceJobId?: string): Promise<void> {
  const currentUrl = window.location.href;

  if (analysisInProgress) {
    console.log("[JobScout] Analysis already in progress, skipping");
    return;
  }

  const data = extractCurrentJob(currentUrl);
  if (!data) {
    console.warn("[JobScout] Extraction failed, aborting");
    return;
  }

  const effectiveJobId = forceJobId ?? data.jobId;

  if (lastAnalyzedJobId === effectiveJobId && !forceJobId) {
    console.log("[JobScout] Already analyzed this job, skipping");
    return;
  }

  // Check cache first — keyed by jobId
  const cacheKey = `score_jobid_${effectiveJobId}`;
  chrome.storage.local.get(cacheKey, (cached) => {
    if (cached[cacheKey] && !forceJobId) {
      console.log("[JobScout] Cache hit for job:", effectiveJobId);
      const stored = cached[cacheKey] as {
        result: AnalyzeResponse;
        jobTitle: string;
        company: string;
        salary: string | null;
        easyApply: boolean;
        jobAge: string | null;
        jobAgeIsOld: boolean;
        url?: string;
      };
      // Backfill URL if missing from old entry
      if (!stored.url && currentUrl) {
        chrome.storage.local.set({
          [cacheKey]: { ...stored, url: currentUrl },
        });
        console.log(
          "[JobScout] Backfilled URL for cached job:",
          effectiveJobId,
        );
      }
      lastAnalyzedJobId = effectiveJobId;
      displayResult(stored.result, data, effectiveJobId, currentUrl);
      return;
    }

    sendToBackend(data, effectiveJobId, currentUrl, forceJobId);
  });
}
// Near the other module-level variables
const inflightJobIds = new Set<string>();
const completedJobIds = new Set<string>();

function sendToBackend(
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
  forceJobId?: string,
): void {
  if (!forceJobId && inflightJobIds.has(effectiveJobId)) {
    console.log(
      "[JobScout] Already in-flight, skipping duplicate sendToBackend:",
      effectiveJobId,
    );
    return;
  }
  inflightJobIds.add(effectiveJobId);
  analysisInProgress = true;
  // ... rest unchanged
  analysisInProgress = true;
  lastAnalyzedJobId = effectiveJobId;

  // Signal to popup that analysis is in progress for this job
  chrome.storage.local.set({ hc_pending_job_id: effectiveJobId });

  console.log(
    "[JobScout] Sending to background worker:",
    data.jobTitle,
    "at",
    data.company,
  );

  chrome.runtime.sendMessage(
    {
      type: forceJobId ? "REANALYZE_JOB" : "ANALYZE_JOB",
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
        lastAnalyzedJobId = "";
        // If there's a bulk queue waiting, process the next one
        return;
      }

      if (!response.success) {
        console.error("[JobScout] Backend error:", response.error);
        lastAnalyzedJobId = "";
        return;
      }

      const result: AnalyzeResponse = response.data;
      saveAndDisplay(result, data, effectiveJobId, currentUrl);
    },
  );
}

function saveAndDisplay(
  result: AnalyzeResponse,
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
): void {
  const cachePayload: Record<string, unknown> = {};
  cachePayload["hc_pending_job_id"] = null; // Clear pending flag on save
  // Key by jobId — works correctly across all sites including hiring.cafe
  cachePayload[`score_jobid_${effectiveJobId}`] = {
    result,
    jobTitle: data.jobTitle,
    company: data.company,
    salary: data.salary,
    easyApply: data.easyApply,
    jobAge: data.jobAge,
    jobAgeIsOld: data.jobAgeIsOld,
    timestamp: Date.now(),
    url: currentUrl,
  };

  cachePayload[`jobid_${effectiveJobId}`] = {
    score: result.fit_score,
    shouldApply: result.should_apply,
    verdict: result.one_line_verdict,
  };

  chrome.storage.local.set(cachePayload, () => {
    inflightJobIds.delete(effectiveJobId);
    console.log(
      "[JobScout] Score saved, updating badges for job:",
      effectiveJobId,
    );
    displayResult(result, data, effectiveJobId, currentUrl);

    if (bulkModeActive && !completedJobIds.has(effectiveJobId)) {
      completedJobIds.add(effectiveJobId);
      bulkMarkComplete(effectiveJobId);
      processBulkQueueNext();
    }
  });
}

function displayResult(
  result: AnalyzeResponse,
  data: JobExtraction,
  effectiveJobId: string,
  currentUrl: string,
): void {
  updateBadgeForJobId(
    effectiveJobId,
    result.fit_score,
    result.should_apply,
    result.one_line_verdict,
  );
  // Update visibility with final score — respects user overrides
  const scoredCard = document.querySelector<HTMLElement>(
    `[data-jobscout-hc-id="${effectiveJobId}"], [data-job-id="${effectiveJobId}"]`,
  );
  if (scoredCard) {
    applyVisibility(
      scoredCard,
      effectiveJobId,
      result.fit_score,
      data.jobTitle,
    );
  }
  // Update hiring.cafe card badge if present
  if (detectSite(currentUrl) === "hiring-cafe") {
    // Find card by current jobId OR update card that modal belongs to
    let card = document.querySelector<HTMLElement>(
      `[data-jobscout-hc-id="${effectiveJobId}"]`,
    );

    // If not found by jobId, find the card whose modal is currently open
    // (carousel case — card still has old jobId)
    if (!card) {
      const modal = document.querySelector<HTMLElement>(".chakra-modal__body");
      if (modal) {
        const titleEl = modal.querySelector<HTMLElement>(
          "h2.font-extrabold, h2[class*='font-extrabold'], h1",
        );
        const modalTitle = titleEl?.innerText?.trim() ?? "";
        if (modalTitle) {
          // Find card whose title span matches the modal title
          document
            .querySelectorAll<HTMLElement>("div.relative.bg-white.rounded-xl")
            .forEach((c) => {
              const titleSpan = c.querySelector<HTMLElement>(
                "span[class*='font-bold'][class*='line-clamp']",
              );
              if (titleSpan?.innerText?.trim() === modalTitle) {
                card = c;
              }
            });
        }
      }
    }

    if (card) {
      // Update card's jobId to current job (fixes carousel)
      card.setAttribute("data-jobscout-hc-id", effectiveJobId);

      const badgeTarget = card.querySelector<HTMLElement>("div.mt-1");
      if (badgeTarget) {
        // Remove any existing badge (from previous carousel position)
        badgeTarget
          .querySelectorAll("[data-jobscout-badge]")
          .forEach((b) => b.remove());

        const badge = document.createElement("span");
        badge.setAttribute("data-jobscout-badge", effectiveJobId);
        badge.style.cssText = `
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          margin-left: 6px;
          vertical-align: middle;
          background: ${result.fit_score >= 80 ? "#052e16" : result.fit_score >= 60 ? "#1c1917" : result.fit_score >= 40 ? "#1c0a00" : "#2d1515"};
          color: ${result.fit_score >= 80 ? "#4ade80" : result.fit_score >= 60 ? "#facc15" : result.fit_score >= 40 ? "#fb923c" : "#f87171"};
          border: 1px solid ${result.fit_score >= 80 ? "#4ade80" : result.fit_score >= 60 ? "#facc15" : result.fit_score >= 40 ? "#fb923c" : "#f87171"};
          cursor: default;
        `;
        badge.textContent = `${result.fit_score}`;
        badge.title = result.one_line_verdict;
        badgeTarget.appendChild(badge);
        console.log(
          "[JobScout Badge] Injected HC card badge post-analysis:",
          effectiveJobId,
          "→",
          result.fit_score,
        );
      }
    }
  }
  addJobToOverlay({
    jobId: effectiveJobId,
    jobTitle: data.jobTitle,
    company: data.company,
    score: result.fit_score,
    shouldApply: result.should_apply,
    salary: data.salary,
    salaryEstimateLow: result.salary_estimate?.low ?? null,
    salaryEstimateHigh: result.salary_estimate?.high ?? null,
    easyApply: data.easyApply,
    url: currentUrl,
  });

  console.log("[JobScout] ===== SCORE RESULT =====");
  console.log(`[JobScout] Site:         ${detectSite(currentUrl)}`);
  console.log(`[JobScout] Fit Score:    ${result.fit_score}/100`);
  console.log(`[JobScout] Should Apply: ${result.should_apply}`);
  console.log(`[JobScout] Verdict:      ${result.one_line_verdict}`);
  console.log(`[JobScout] Salary:       ${data.salary ?? "not found"}`);
  console.log(`[JobScout] Easy Apply:   ${data.easyApply}`);
  console.log(
    `[JobScout] Job Age:      ${data.jobAge ?? "not found"} (old: ${data.jobAgeIsOld})`,
  );
  console.log("[JobScout] =========================");
}

function waitForContentThenAnalyze(forceJobId?: string): void {
  console.log("[JobScout] Waiting for job content to render...");
  let attempts = 0;
  const maxAttempts = 40;

  const interval = setInterval(() => {
    attempts++;
    const currentUrl = window.location.href;
    const site = detectSite(currentUrl);

    if (!site) {
      clearInterval(interval);
      return;
    }

    const descriptionSelectors: Record<string, string> = {
      linkedin: ".jobs-description__content .jobs-box__html-content",
      indeed: "#jobDescriptionText, .jobsearch-jobDescriptionText",
      "hiring-cafe": ".chakra-modal__body",
    };

    const selector = descriptionSelectors[site];
    const el = document.querySelector<HTMLElement>(selector);

    if (el && el.innerText.trim().length > 100) {
      clearInterval(interval);
      console.log(
        `[JobScout] ${site} content ready after ${attempts} attempts`,
      );
      analyzeJob(forceJobId);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.warn(
        "[JobScout] Content never rendered after",
        maxAttempts,
        "attempts",
      );
    }
  }, 500);
}

function onUrlChange(newUrl: string): void {
  console.log("[JobScout] URL changed to:", newUrl);

  const site = detectSite(newUrl);
  if (!site) {
    console.log("[JobScout] Not a supported job page, skipping");
    return;
  }

  if (site === "hiring-cafe") return;

  const jobIdMatch = newUrl.match(/currentJobId=(\d+)/);
  if (jobIdMatch) {
    updateOverlayActiveJob(jobIdMatch[1]);
  }

  if (bulkModeActive) {
    // In bulk mode — extract and queue without waiting for user to trigger
    console.log(
      "[JobScout Bulk] URL change detected in bulk mode, queuing job",
    );
    setTimeout(() => {
      const data = extractCurrentJob(newUrl);
      if (!data) return;
      const effectiveJobId = data.jobId;
      chrome.storage.local.get(`score_jobid_${effectiveJobId}`, (cached) => {
        if (cached[`score_jobid_${effectiveJobId}`]) {
          console.log(
            "[JobScout Bulk] Already scored, skipping:",
            effectiveJobId,
          );
          return;
        }
        addToBulkQueue(effectiveJobId, data, newUrl);
      });
    }, 1500); // Wait for content to render
  } else {
    waitForContentThenAnalyze();
  }
}

// ===== BULK SCORING =====
// Queue-based: you open each card manually, extraction queues automatically,
// background processor fires one at a time without blocking your browsing.

interface BulkQueueItem {
  jobId: string;
  data: JobExtraction;
  url: string;
}

let bulkQueue: BulkQueueItem[] = [];
let bulkProcessing = false;
let bulkTotal = 0;
let bulkCompleted = 0;

let bulkModeActive = false; // ADD THIS LINE near the other bulk variables
// Clear any stale bulk mode state from previous session
chrome.storage.local.set({ hc_bulk_mode_active: false });

function buildHCJobId(title: string, company: string): string {
  const input = `${title.toLowerCase().trim()}|${company.toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `hc_${Math.abs(hash).toString(16)}`;
}

function isInBulkQueue(jobId: string): boolean {
  return bulkQueue.some((item) => item.jobId === jobId);
}

function addToBulkQueue(jobId: string, data: JobExtraction, url: string): void {
  if (isInBulkQueue(jobId)) {
    console.log("[JobScout Bulk] Already in queue:", jobId);
    return;
  }

  // Check cache — skip if already scored
  chrome.storage.local.get(`score_jobid_${jobId}`, (cached) => {
    if (cached[`score_jobid_${jobId}`]) {
      console.log("[JobScout Bulk] Already scored, not queuing:", jobId);
      return;
    }

    bulkQueue.push({ jobId, data, url });
    bulkTotal++;
    console.log(
      `[JobScout Bulk] Queued: ${data.jobTitle} (queue size: ${bulkQueue.length})`,
    );
    updateBulkProgress();

    // Start processing if not already running
    if (!bulkProcessing && !analysisInProgress) {
      processBulkQueueNext();
    }
  });
}

function bulkMarkComplete(jobId: string): void {
  const idx = bulkQueue.findIndex((item) => item.jobId === jobId);
  if (idx !== -1) {
    bulkQueue.splice(idx, 1);
    bulkCompleted++;
    console.log(
      `[JobScout Bulk] Completed: ${jobId} (${bulkCompleted}/${bulkTotal})`,
    );
    updateBulkProgress();
  }
}

function processBulkQueueNext(): void {
  if (bulkProcessing || analysisInProgress) return;
  if (bulkQueue.length === 0) {
    if (bulkTotal > 0) {
      console.log(`[JobScout Bulk] Queue empty — ${bulkCompleted} jobs scored`);
      updateBulkProgress();
    }
    return;
  }

  const next = bulkQueue[0];
  console.log(
    `[JobScout Bulk] Processing next: ${next.data.jobTitle} (${bulkQueue.length} remaining)`,
  );

  chrome.storage.local.get(`score_jobid_${next.jobId}`, (cached) => {
    if (cached[`score_jobid_${next.jobId}`]) {
      console.log(
        "[JobScout Bulk] Already scored since queuing, skipping:",
        next.jobId,
      );
      bulkMarkComplete(next.jobId);
      processBulkQueueNext();
      return;
    }

    // Set analysisInProgress directly here before sendToBackend so nothing
    // else can sneak in between the cache check and the API call
    analysisInProgress = true;
    lastAnalyzedJobId = next.jobId;
    chrome.storage.local.set({ hc_pending_job_id: next.jobId });

    console.log(
      "[JobScout] Sending to background worker:",
      next.data.jobTitle,
      "at",
      next.data.company,
    );

    chrome.runtime.sendMessage(
      {
        type: "ANALYZE_JOB",
        payload: {
          job_title: next.data.jobTitle,
          company: next.data.company,
          job_description: next.data.jobDescription,
          url: next.url,
          listed_salary: next.data.salary,
        },
      },
      (response) => {
        analysisInProgress = false;

        if (chrome.runtime.lastError) {
          console.error(
            "[JobScout] Message error:",
            chrome.runtime.lastError.message,
          );
          bulkMarkComplete(next.jobId);
          processBulkQueueNext();
          return;
        }

        if (!response.success) {
          console.error("[JobScout] Backend error:", response.error);
          bulkMarkComplete(next.jobId);
          processBulkQueueNext();
          return;
        }

        const result: AnalyzeResponse = response.data;
        saveAndDisplay(result, next.data, next.jobId, next.url);
      },
    );
  });
}

function updateBulkProgress(): void {
  chrome.runtime.sendMessage({
    type: "BULK_PROGRESS",
    completed: bulkCompleted,
    total: bulkTotal,
    queued: bulkQueue.length,
    running: bulkQueue.length > 0 || analysisInProgress,
  });
}

function startBulkScoring(): void {
  bulkModeActive = true;
  chrome.storage.local.set({ hc_bulk_mode_active: true });
  console.log(
    "[JobScout Bulk] Bulk queue mode enabled — open cards to queue them",
  );
  updateBulkProgress();
}

function cancelBulkScoring(): void {
  bulkQueue = [];
  bulkProcessing = false;
  bulkTotal = 0;
  bulkCompleted = 0;
  bulkModeActive = false;
  chrome.storage.local.set({ hc_bulk_mode_active: false });
  updateBulkProgress();
  console.log("[JobScout Bulk] Queue cleared and bulk mode disabled");
}

// ===== HIRING CAFE MODAL WATCHER =====

function initHiringCafeModalWatcher(): void {
  if (!isHiringCafePage(window.location.href)) return;

  console.log("[JobScout] Initializing Hiring.cafe modal watcher");
  let lastModalJobId = "";

  const modalObserver = new MutationObserver(() => {
    const modal = document.querySelector<HTMLElement>(".chakra-modal__body");
    if (!modal || modal.innerText.trim().length < 100) return;

    const titleEl = modal.querySelector<HTMLElement>(
      "h2.font-extrabold, h2[class*='font-extrabold'], h1",
    );
    const title = titleEl?.innerText?.trim() ?? "";
    if (!title) return;

    // Extract company for a collision-resistant ID (title alone collides across companies)
    const companyEl = modal.querySelector<HTMLElement>(
      "span[class*='text-xl'][class*='font-semibold'], span[class*='font-semibold'][class*='text-gray'], span[class*='font-semibold']",
    );
    const company = companyEl?.innerText?.trim().replace(/^@\s*/, "") ?? "";

    const currentJobId = buildHCJobId(title, company);

    if (currentJobId === lastModalJobId) return;
    lastModalJobId = currentJobId;

    // Track the active job immediately so the popup can look it up even on cache hits
    chrome.storage.local.set({ hc_active_job_id: currentJobId });

    console.log("[JobScout] Hiring.cafe modal detected for:", title, "@ ", company);
    analysisInProgress = false;
    lastAnalyzedJobId = "";

    setTimeout(() => {
      const currentUrl = window.location.href;
      const extractionResult = extractHiringCafe(currentUrl);

      if (extractionResult.success && extractionResult.data) {
        const data = extractionResult.data;
        // Use title+company hash as the canonical job ID (consistent with card observer)
        const jobId = buildHCJobId(data.jobTitle, data.company);

        // Update active job ID to the accurate post-extraction ID
        chrome.storage.local.set({ hc_active_job_id: jobId });

        chrome.storage.local.get(`score_jobid_${jobId}`, (cached) => {
          if (cached[`score_jobid_${jobId}`]) {
            console.log("[JobScout] Cache hit for job:", jobId);
            displayResult(
              (cached[`score_jobid_${jobId}`] as { result: AnalyzeResponse })
                .result,
              data,
              jobId,
              currentUrl,
            );
          } else if (bulkModeActive) {
            // Bulk mode — queue only, do NOT call waitForContentThenAnalyze
            console.log("[JobScout] Bulk mode: queuing job:", data.jobTitle);
            addToBulkQueue(jobId, data, currentUrl);
            // Do not fall through to waitForContentThenAnalyze
          } else {
            // Normal single-job mode
            waitForContentThenAnalyze(jobId);
          }
        });
      } else {
        if (!bulkModeActive) {
          waitForContentThenAnalyze(currentJobId);
        }
      }
    }, 500);
  });

  modalObserver.observe(document.body, { childList: true, subtree: true });
}

function initCardObserver(): void {
  console.log("[JobScout] Initializing card observer");

  const cardSelectors: Record<string, string> = {
    linkedin:
      ".job-card-container, .jobs-search-results__list-item, [data-job-id]",
    indeed: "[id^='sj_'], .job_seen_beacon, .resultContent",
    "hiring-cafe": "div.relative.bg-white.rounded-xl",
  };

  const scanCards = (): void => {
    const site = detectSite(window.location.href);
    if (!site) return;

    const selector = cardSelectors[site];
    document.querySelectorAll(selector).forEach((card) => {
      if (card.hasAttribute("data-jobscout-processed")) return;

      if (site === "hiring-cafe") {
        const titleSpan = card.querySelector<HTMLElement>(
          "span[class*='font-bold'][class*='line-clamp']",
        );
        if (!titleSpan) return;

        const title = titleSpan.innerText.trim();
        if (!title || title.length < 3) return;

        // Include company to avoid collisions between same-title jobs at different companies
        const companySpan = card.querySelector<HTMLElement>(
          "span.font-bold:not([class*='line-clamp'])",
        );
        const company = companySpan?.innerText?.trim() ?? "";

        const jobId = buildHCJobId(title, company);

        card.setAttribute("data-jobscout-processed", "true");
        card.setAttribute("data-jobscout-hc-id", jobId);

        // Apply visibility — checks user overrides, cache, then keywords
        applyVisibility(card, jobId, undefined, title);

        const badgeTarget = titleSpan.closest("div.mt-1");
        if (!badgeTarget) return;

        const storageKey = `jobid_${jobId}`;
        chrome.storage.local.get(storageKey, (data) => {
          const stored = data[storageKey] as
            | { score: number; shouldApply: boolean; verdict: string }
            | undefined;
          if (stored) {
            // Update visibility with actual score
            applyVisibility(card, jobId, stored.score, title);
            const badge = document.createElement("span");
            badge.setAttribute("data-jobscout-badge", jobId);
            badge.style.cssText = `
              display: inline-block;
              font-size: 10px;
              font-weight: 700;
              padding: 1px 5px;
              border-radius: 4px;
              margin-left: 6px;
              vertical-align: middle;
              background: ${stored.score >= 80 ? "#052e16" : stored.score >= 60 ? "#1c1917" : stored.score >= 40 ? "#1c0a00" : "#2d1515"};
              color: ${stored.score >= 80 ? "#4ade80" : stored.score >= 60 ? "#facc15" : stored.score >= 40 ? "#fb923c" : "#f87171"};
              border: 1px solid ${stored.score >= 80 ? "#4ade80" : stored.score >= 60 ? "#facc15" : stored.score >= 40 ? "#fb923c" : "#f87171"};
              cursor: default;
            `;
            badge.textContent = `${stored.score}`;
            badge.title = stored.verdict;
            badgeTarget.appendChild(badge);
            console.log(
              "[JobScout Badge] Injected HC card badge for:",
              title.substring(0, 30),
              "→",
              stored.score,
            );
          }
        });
        return;
      }

      card.setAttribute("data-jobscout-processed", "true");

      // Keyword dim for LinkedIn/Indeed
      const titleEl = card.querySelector<HTMLElement>(
        ".job-card-list__title, .jobTitle, [class*='title']",
      );
      const cardTitle = titleEl?.innerText?.trim() ?? "";
      const cardJobId = extractCardJobId(card, window.location.href);

      if (cardJobId) {
        chrome.storage.local.get(`jobid_${cardJobId}`, (data) => {
          const stored = data[`jobid_${cardJobId}`] as
            | { score: number; shouldApply: boolean; verdict: string }
            | undefined;
          // Delay vis button so badge.ts has time to inject the badge first
          setTimeout(() => {
            applyVisibility(card, cardJobId, stored?.score, cardTitle);
          }, 200);
        });
      } else if (cardTitle) {
        setTimeout(() => {
          applyVisibility(
            card,
            `pending_${cardTitle.substring(0, 20)}`,
            undefined,
            cardTitle,
          );
        }, 200);
      }

      checkAndInjectFromStorage(card);
    });
  };

  const cardObserver = new MutationObserver(() => scanCards());
  cardObserver.observe(document.body, { childList: true, subtree: true });
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

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[JobScout] URL watcher initialized");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TRIGGER_REANALYZE") {
    console.log("[JobScout] Re-analyze triggered from popup");
    lastAnalyzedJobId = "";
    analysisInProgress = false;
    waitForContentThenAnalyze();
  }

  if (message.type === "START_BULK_SCORING") {
    console.log("[JobScout] Bulk scoring status requested from popup");
    startBulkScoring();
  }

  if (message.type === "CANCEL_BULK_SCORING") {
    console.log("[JobScout] Bulk scoring cancelled from popup");
    cancelBulkScoring();
  }

  if (message.type === "GET_BULK_STATUS") {
    updateBulkProgress();
  }
  if (message.type === "HIGHLIGHT_HC_CARD") {
    const jobId = message.jobId as string;
    const card = document.querySelector<HTMLElement>(
      `[data-jobscout-hc-id="${jobId}"]`,
    );
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.style.transition = "box-shadow 0.3s ease";
      card.style.boxShadow = "0 0 0 3px #38bdf8";
      setTimeout(() => {
        card.style.boxShadow = "";
      }, 2000);
      sendResponse({ found: true });
    } else {
      sendResponse({ found: false });
    }
    return true; // Keep message channel open for async response
  }
  if (message.type === "SCROLL_TO_LOAD") {
    window.scrollBy({ top: 600, behavior: "smooth" });
    sendResponse({});
    return true;
  }
});

initUrlWatcher();
initCardObserver();
initHiringCafeModalWatcher();
onUrlChange(window.location.href);
