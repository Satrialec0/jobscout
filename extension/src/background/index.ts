console.log("[JobScout] Background service worker started");

interface AnalyzeRequest {
  job_title: string;
  company: string;
  job_description: string;
  url: string;
}

const BACKEND_URL = "http://127.0.0.1:8000/api/v1";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[JobScout] Extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ANALYZE_JOB" || message.type === "REANALYZE_JOB") {
    console.log(
      "[JobScout BG] Received",
      message.type,
      "for:",
      message.payload.job_title,
    );

    if (message.type === "REANALYZE_JOB") {
      const jobIdMatch = message.payload.url.match(/currentJobId=(\d+)/);
      if (jobIdMatch) {
        chrome.storage.local.remove(
          [`score_${message.payload.url}`, `jobid_${jobIdMatch[1]}`],
          () => {
            console.log("[JobScout BG] Cleared cache for re-analysis");
          },
        );
      }
    }

    fetchAnalysis(message.payload)
      .then((result) => {
        console.log(
          "[JobScout BG] Analysis complete, fit_score:",
          result.fit_score,
        );
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        console.error("[JobScout BG] Analysis failed:", err);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (message.type === "GET_SCORE") {
    console.log("[JobScout BG] GET_SCORE for url:", message.url);

    chrome.storage.local.get(`score_${message.url}`, (data) => {
      const key = `score_${message.url}`;
      if (data[key]) {
        console.log("[JobScout BG] Score found in storage");
        sendResponse({ success: true, data: data[key] });
      } else {
        sendResponse({ success: false });
      }
    });

    return true;
  }

  if (message.type === "GET_SCORE_FROM_BACKEND") {
    console.log(
      "[JobScout BG] Fetching score from backend for job_id:",
      message.jobId,
    );

    fetch(`${BACKEND_URL}/score/${message.jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Not found`);
        return r.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch(() => sendResponse({ success: false }));

    return true;
  }

  if (message.type === "GET_COMPANY_INFO") {
    console.log("[JobScout BG] Getting company info for:", message.payload?.company);

    fetch(`${BACKEND_URL}/company-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((r) => {
        if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
        return r.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true;
  }

  if (message.type === "GENERATE_INTERVIEW_PREP") {
    console.log(
      "[JobScout BG] Generating interview prep for:",
      message.payload?.job_title,
    );

    fetch(`${BACKEND_URL}/interview-prep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((r) => {
        if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
        return r.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true;
  }

  if (message.type === "MARK_APPLIED") {
    console.log("[JobScout BG] Marking applied for job_id:", message.jobId);

    chrome.storage.local.set({ [`applied_${message.jobId}`]: true }, () => {
      console.log("[JobScout BG] Marked applied in storage");
    });

    fetch(`${BACKEND_URL}/applied/${message.jobId}`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));

    return true;
  }
});

async function fetchAnalysis(payload: AnalyzeRequest) {
  console.log("[JobScout BG] Fetching from backend...");

  const response = await fetch(`${BACKEND_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  return response.json();
}
