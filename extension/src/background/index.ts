console.log("[JobScout] Background service worker started");

interface AnalyzeRequest {
  job_title: string;
  company: string;
  job_description: string;
  url: string;
}

const BACKEND_URL = "http://127.0.0.1:8000/api/v1/analyze";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[JobScout] Extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ANALYZE_JOB") {
    console.log(
      "[JobScout BG] Received ANALYZE_JOB for:",
      message.payload.job_title,
    );

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
    console.log("[JobScout BG] Received GET_SCORE for url:", message.url);

    chrome.storage.local.get(`score_${message.url}`, (data) => {
      const key = `score_${message.url}`;
      if (data[key]) {
        console.log("[JobScout BG] Score found in storage");
        sendResponse({ success: true, data: data[key] });
      } else {
        console.log("[JobScout BG] No score found for this URL");
        sendResponse({ success: false });
      }
    });

    return true;
  }
});

async function fetchAnalysis(payload: AnalyzeRequest) {
  console.log("[JobScout BG] Fetching from backend...");

  const response = await fetch(BACKEND_URL, {
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
