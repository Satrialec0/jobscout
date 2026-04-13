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

async function seedTargetKeywords(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/profiles/${profileId}/target-keywords`, { headers });
    if (!r.ok) return;
    const keywords: Array<{ id: number; keyword: string; source: string }> = await r.json();
    const updates: Record<string, boolean> = {};
    for (const kw of keywords) {
      updates[`kw_target_profile_${kw.keyword}`] = true;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed target keywords:", err);
  }
}

async function seedTargetSignals(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/keywords/target-signals/${profileId}`, { headers });
    if (!r.ok) return;
    const signals: Array<{ ngram: string; target_count: number; show_count: number }> = await r.json();
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const sig of signals) {
      updates[`kw_target_${sig.ngram}`] = { targetCount: sig.target_count, showCount: sig.show_count };
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed target signals:", err);
  }
}

async function seedCompanies(profileId: number): Promise<void> {
  const headers = await getAuthHeaders();
  try {
    const r = await fetch(`${BACKEND_URL}/companies?profile_id=${profileId}`, { headers });
    if (!r.ok) return;
    const data: {
      targets: Array<{ id: number; name: string }>;
      blocks: Array<{ id: number; name: string }>;
    } = await r.json();
    const updates: Record<string, boolean> = {};
    for (const c of data.targets) {
      updates[`company_target_${c.name.toLowerCase()}`] = true;
    }
    for (const c of data.blocks) {
      updates[`company_block_${c.name.toLowerCase()}`] = true;
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error("[JobScout BG] Failed to seed companies:", err);
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
    chrome.storage.local.set({ active_profile_id: profile.id, active_profile_name: profile.name });
    await seedSignals(profile.id);
    await seedTargetKeywords(profile.id);
    await seedTargetSignals(profile.id);
    await seedCompanies(profile.id);
  } catch (err) {
    console.error("[JobScout BG] Failed to seed keyword data:", err);
  }
}

// ===== SIGNAL SYNC =====

const dirtyNgrams = new Set<string>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 30_000;

function scheduleSyncSignals(): void {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    flushSignals();
  }, SYNC_DEBOUNCE_MS);
}

async function flushSignals(): Promise<void> {
  if (dirtyNgrams.size === 0) return;
  const toFlush = Array.from(dirtyNgrams);
  dirtyNgrams.clear();

  const hideKeys = toFlush.map((ng) => `kw_hide_${ng}`);
  const showKeys = toFlush.map((ng) => `kw_show_${ng}`);

  chrome.storage.local.get(["active_profile_id", ...hideKeys, ...showKeys], async (data) => {
    const profileId = data["active_profile_id"] as number | undefined;
    if (!profileId) return;

    const payload = toFlush.map((ng) => ({
      ngram: ng,
      hide_count: (data[`kw_hide_${ng}`] as number) ?? 0,
      show_count: (data[`kw_show_${ng}`] as number) ?? 0,
    }));

    const headers = await getAuthHeaders();
    fetch(`${BACKEND_URL}/keywords/signals/${profileId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ signals: payload }),
    }).catch((err) => console.error("[JobScout BG] Signal sync failed:", err));
  });
}

// ===== TARGET SIGNAL SYNC =====

const dirtyTargetNgrams = new Set<string>();
let targetSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTargetSignalSync(): void {
  if (targetSyncTimer !== null) clearTimeout(targetSyncTimer);
  targetSyncTimer = setTimeout(() => {
    targetSyncTimer = null;
    flushTargetSignals();
  }, SYNC_DEBOUNCE_MS);
}

async function flushTargetSignals(): Promise<void> {
  if (dirtyTargetNgrams.size === 0) return;
  const toFlush = Array.from(dirtyTargetNgrams);
  dirtyTargetNgrams.clear();

  const targetKeys = toFlush.map((ng) => `kw_target_${ng}`);

  chrome.storage.local.get(["active_profile_id", ...targetKeys], async (data) => {
    const profileId = data["active_profile_id"] as number | undefined;
    if (!profileId) return;

    const payload = toFlush.map((ng) => {
      const entry = data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined;
      return {
        ngram: ng,
        target_count: entry?.targetCount ?? 0,
        show_count: entry?.showCount ?? 0,
      };
    });

    const headers = await getAuthHeaders();
    fetch(`${BACKEND_URL}/keywords/target-signals/${profileId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ signals: payload }),
    }).catch((err) => console.error("[JobScout BG] Target signal sync failed:", err));
  });
}

function mineTargetSignalsFromAnalysis(
  greenFlags: string[],
  company: string,
  profileId: number,
): void {
  if (!profileId) return;

  const allNgrams: string[] = [];
  for (const flag of greenFlags) {
    const words = flag
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    allNgrams.push(...words);
    for (let i = 0; i < words.length - 1; i++) {
      allNgrams.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  if (allNgrams.length === 0 && !company) return;

  const targetKeys = allNgrams.map((ng) => `kw_target_${ng}`);
  chrome.storage.local.get(targetKeys, (data) => {
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const ng of allNgrams) {
      const existing = (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined) ?? { targetCount: 0, showCount: 0 };
      updates[`kw_target_${ng}`] = { targetCount: existing.targetCount + 1, showCount: existing.showCount };
    }
    chrome.storage.local.set(updates);
  });

  if (company) {
    const key = `company_target_${company.toLowerCase()}`;
    chrome.storage.local.set({ [key]: true });
    getAuthHeaders().then((headers) => {
      chrome.storage.local.get("active_profile_id", (d) => {
        const pid = d["active_profile_id"] as number | undefined;
        if (!pid) return;
        fetch(`${BACKEND_URL}/companies/target`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: company, profile_id: pid }),
        }).catch(() => {});
      });
    });
  }
}

function mineTargetSignalsFromTitle(title: string): void {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const ngrams: string[] = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(`${words[i]} ${words[i + 1]}`);
  }

  if (ngrams.length === 0) return;

  const targetKeys = ngrams.map((ng) => `kw_target_${ng}`);
  chrome.storage.local.get(targetKeys, (data) => {
    const updates: Record<string, { targetCount: number; showCount: number }> = {};
    for (const ng of ngrams) {
      const existing = (data[`kw_target_${ng}`] as { targetCount: number; showCount: number } | undefined) ?? { targetCount: 0, showCount: 0 };
      updates[`kw_target_${ng}`] = { targetCount: existing.targetCount + 1, showCount: existing.showCount };
    }
    chrome.storage.local.set(updates);
  });
}

// Watch for kw_* changes written by the content script
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(changes)) {
    if (key.startsWith("kw_hide_") || key.startsWith("kw_show_")) {
      dirtyNgrams.add(key.replace(/^kw_(?:hide|show)_/, ""));
    }
    if (key.startsWith("kw_target_") && !key.startsWith("kw_target_profile_")) {
      dirtyTargetNgrams.add(key.replace(/^kw_target_/, ""));
    }
  }
  if (dirtyNgrams.size > 0) scheduleSyncSignals();
  if (dirtyTargetNgrams.size > 0) scheduleTargetSignalSync();
});

// Flush on service worker shutdown
chrome.runtime.onSuspend.addListener(() => {
  if (syncTimer !== null) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (targetSyncTimer !== null) {
    clearTimeout(targetSyncTimer);
    targetSyncTimer = null;
  }
  flushSignals();
  flushTargetSignals();
});

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
      .then(async (result) => {
        console.log("[JobScout BG] Analysis complete, fit_score:", result.fit_score);
        // Mine target signals from high-scoring analyses
        if (result.fit_score >= 80) {
          chrome.storage.local.get("active_profile_id", (profileData) => {
            const profileId = profileData["active_profile_id"] as number | undefined;
            if (profileId) {
              mineTargetSignalsFromAnalysis(
                result.green_flags ?? [],
                message.payload.company ?? "",
                profileId,
              );
            }
          });
        }
        // Read profile name from storage; if missing, fetch it now so the
        // content script always gets a name without depending on login timing.
        const stored = await new Promise<Record<string, unknown>>((resolve) =>
          chrome.storage.local.get("active_profile_name", (items) => resolve(items)),
        );
        let profileName = stored["active_profile_name"] as string | undefined;
        if (!profileName) {
          try {
            const headers = await getAuthHeaders();
            const r = await fetch(`${BACKEND_URL}/profiles/active`, { headers });
            if (r.ok) {
              const profile: { id: number; name: string } | null = await r.json();
              if (profile) {
                profileName = profile.name;
                chrome.storage.local.set({ active_profile_id: profile.id, active_profile_name: profile.name });
              }
            }
          } catch { /* profile name stays undefined */ }
        }
        sendResponse({ success: true, data: result, profileName });
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

    // Mine title ngrams when user marks a job as applied
    if (message.status === "applied" && message.jobId) {
      chrome.storage.local.get(`score_jobid_${message.jobId}`, (data) => {
        const stored = data[`score_jobid_${message.jobId}`] as { jobTitle?: string } | undefined;
        if (stored?.jobTitle) {
          mineTargetSignalsFromTitle(stored.jobTitle);
        }
      });
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

  if (message.type === "SWITCH_PROFILE") {
    // Flush pending signals for the outgoing profile first
    if (syncTimer !== null) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    if (targetSyncTimer !== null) {
      clearTimeout(targetSyncTimer);
      targetSyncTimer = null;
    }
    flushSignals().then(async () => {
      await flushTargetSignals();
      // Clear all per-profile kw_* and targeting keys from local storage
      chrome.storage.local.get(null, async (items) => {
        const keysToRemove = Object.keys(items).filter(
          (k) =>
            k.startsWith("kw_hide_") ||
            k.startsWith("kw_show_") ||
            k.startsWith("kw_target_") ||
            k.startsWith("company_target_"),
        );
        if (keysToRemove.length > 0) {
          await new Promise<void>((resolve) =>
            chrome.storage.local.remove(keysToRemove, resolve),
          );
        }

        // Store new active profile and seed its signals
        chrome.storage.local.set({ active_profile_id: message.profileId, active_profile_name: message.profileName ?? null });
        await seedSignals(message.profileId as number);
        await seedTargetKeywords(message.profileId as number);
        await seedTargetSignals(message.profileId as number);
        await seedCompanies(message.profileId as number);

        // Notify all content scripts
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: "PROFILE_SWITCHED" }).catch(() => {});
            }
          });
        });

        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'HIRING_CAFE_NAVIGATED') {
    syncHiringCafeCookies();
    return;
  }

  if (message.type === 'REGISTER_SEARCH') {
    const { name, search_state } = message.payload as { name: string; search_state: unknown };
    chrome.storage.local.get('auth_jwt', async (data) => {
      const jwt = data.auth_jwt as string | undefined;
      if (!jwt) { sendResponse({ ok: false, error: 'Not logged in' }); return; }
      try {
        const r = await fetch(`${BACKEND_URL}/api/v1/scraper/searches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
          body: JSON.stringify({ name, search_state }),
        });
        if (r.ok) {
          sendResponse({ ok: true });
        } else {
          const err = await r.json();
          sendResponse({ ok: false, error: (err as { detail?: string }).detail || 'Failed to register search' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    });
    return true;
  }
});

async function syncHiringCafeCookies(): Promise<void> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'hiring.cafe' });
    if (cookies.length === 0) return;

    // Reconstruct a full Cookie header string from all domain cookies
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const data = await chrome.storage.local.get('auth_jwt');
    const jwt = data.auth_jwt as string | undefined;
    if (!jwt) return;

    await fetch(`${BACKEND_URL}/api/v1/scraper/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ cookie_header: cookieHeader }),
    });
    console.log('[JobScout BG] hiring.cafe cookies synced to backend');
  } catch (err) {
    console.error('[JobScout BG] Failed to sync hiring.cafe cookies:', err);
  }
}

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
