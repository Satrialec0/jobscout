console.log("[JobScout] Background service worker started");

interface AnalyzeRequest {
  job_title: string;
  company: string;
  job_description: string;
  url: string;
}

const BACKEND_URL = process.env.BACKEND_URL;

chrome.runtime.onInstalled.addListener(() => {
  console.log("[JobScout] Extension installed");
});

async function getAuthHeaders(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    chrome.storage.local.get("auth_jwt", (data) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (data.auth_jwt) {
        headers["Authorization"] = `Bearer ${data.auth_jwt as string}`;
      }
      resolve(headers);
    });
  });
}

function handle401() {
  chrome.storage.local.remove("auth_jwt");
  chrome.runtime.sendMessage({ type: "AUTH_REQUIRED" }).catch(() => {});
}

async function seedBlocklist(): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/blocklist`, { headers });
    if (!r.ok) return;
    const data: { terms: string[] } = await r.json();
    chrome.storage.local.set({ blocklist: data.terms });
  } catch (err) {
    console.error("[JobScout BG] Failed to seed blocklist:", err);
  }
}

async function seedSignals(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/signals/${profileId}`, { headers });
    if (!r.ok) return;
    const signals: Array<{ ngram: string; hide_count: number; show_count: number }> = await r.json();
    const updates: Record<string, number> = {};
    for (const sig of signals) {
      updates[`kw_hide_${sig.ngram}`] = sig.hide_count;
      updates[`kw_show_${sig.ngram}`] = sig.show_count;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed signals:", err);
  }
}

async function seedKeywordData(): Promise<void> {
  await seedBlocklist();
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/profiles/active`, { headers });
    if (!r.ok) return;
    const profile: { id: number; name: string } | null = await r.json();
    if (!profile) return;
    chrome.storage.local.set({ active_profile_id: profile.id });
    await seedSignals(profile.id);
  } catch (err) {
    console.error("[JobScout BG] Failed to seed keyword data:", err);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "LOGIN") {
    fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: message.email, password: message.password }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.detail || "Login failed");
        chrome.storage.local.set({ auth_jwt: data.access_token });
        sendResponse({ success: true, hasApiKey: data.has_api_key });
        // Fire-and-forget: seed keyword data after login
        seedKeywordData();
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "LOGOUT") {
    chrome.storage.local.clear(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "SAVE_API_KEY") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/auth/api-key`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ api_key: message.apiKey }),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data.detail || "Failed to save key");
          sendResponse({ success: true });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "ANALYZE_JOB" || message.type === "REANALYZE_JOB") {
    console.log("[JobScout BG] Received", message.type, "for:", message.payload.job_title);

    if (message.type === "REANALYZE_JOB") {
      const jobIdMatch = message.payload.url.match(/currentJobId=(\d+)/);
      if (jobIdMatch) {
        chrome.storage.local.remove(
          [`score_${message.payload.url}`, `jobid_${jobIdMatch[1]}`],
          () => console.log("[JobScout BG] Cleared cache for re-analysis"),
        );
      }
    }

    fetchAnalysis(message.payload)
      .then((result) => {
        console.log("[JobScout BG] Analysis complete, fit_score:", result.fit_score);
        sendResponse({ success: true, data: result });
      })
      .catch((err) => {
        console.error("[JobScout BG] Analysis failed:", err);
        sendResponse({ success: false, error: err.message, code: (err as { code?: number }).code });
      });

    return true;
  }

  if (message.type === "GET_SCORE") {
    chrome.storage.local.get(`score_${message.url}`, (data) => {
      const key = `score_${message.url}`;
      if (data[key]) {
        sendResponse({ success: true, data: data[key] });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  if (message.type === "GET_SCORE_FROM_BACKEND") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/score/${message.jobId}`, { headers })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (!r.ok) throw new Error("Not found");
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch(() => sendResponse({ success: false }));
    });
    return true;
  }

  if (message.type === "GET_COMPANY_INFO") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/company-info`, {
        method: "POST",
        headers,
        body: JSON.stringify(message.payload),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (r.status === 402) throw new Error("no_api_key");
          if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "GENERATE_INTERVIEW_PREP") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/interview-prep`, {
        method: "POST",
        headers,
        body: JSON.stringify(message.payload),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (r.status === 402) throw new Error("no_api_key");
          if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "GENERATE_COVER_LETTER") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/cover-letter`, {
        method: "POST",
        headers,
        body: JSON.stringify(message.payload),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (r.status === 402) throw new Error("no_api_key");
          if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "GENERATE_APP_ANSWER") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/app-question`, {
        method: "POST",
        headers,
        body: JSON.stringify(message.payload),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (r.status === 402) throw new Error("no_api_key");
          if (!r.ok) return r.text().then((t) => { throw new Error(`Backend error ${r.status}: ${t}`); });
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "GET_APP_ASSIST") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/app-assist/${message.dbId}`, { headers })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          if (r.status === 404) throw new Error("not_found");
          if (!r.ok) throw new Error(`Backend error ${r.status}`);
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "SAVE_APP_ASSIST") {
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/app-assist/${message.dbId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(message.payload),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); }
          if (!r.ok) throw new Error(`Backend error ${r.status}`);
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "MARK_APPLIED") {
    chrome.storage.local.set({ [`applied_${message.jobId}`]: true });
    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/applied/${message.jobId}`, { method: "POST", headers })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          return r.json();
        })
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (message.type === "UPDATE_JOB_STATUS") {
    // Update local storage immediately
    if (message.status === null) {
      chrome.storage.local.remove(`status_${message.jobId}`);
    } else {
      chrome.storage.local.set({ [`status_${message.jobId}`]: message.status });
    }

    if (!message.dbId) { sendResponse({ success: true }); return true; }

    getAuthHeaders().then((headers) => {
      fetch(`${BACKEND_URL}/job/${message.dbId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: message.status,
          ...(message.appliedDate ? { applied_date: message.appliedDate } : {}),
        }),
      })
        .then((r) => {
          if (r.status === 401) { handle401(); throw new Error("Unauthorized"); }
          return r.ok ? r.json() : Promise.reject(new Error(`PATCH failed ${r.status}`));
        })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});

async function fetchAnalysis(payload: AnalyzeRequest) {
  console.log("[JobScout BG] Fetching from backend...");
  const headers = await getAuthHeaders();

  const response = await fetch(`${BACKEND_URL}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (response.status === 401) {
    handle401();
    const err = new Error("Authentication required. Please sign in to JobScout.");
    (err as { code?: number }).code = 401;
    throw err;
  }

  if (response.status === 402) {
    const err = new Error("no_api_key");
    (err as { code?: number }).code = 402;
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  return response.json();
}

export {};
