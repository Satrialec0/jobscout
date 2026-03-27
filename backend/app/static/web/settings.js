const API = "";

function getToken() { return localStorage.getItem("jobscout_jwt"); }

async function authFetch(url, opts = {}) {
  const token = getToken();
  if (!token) { window.location.href = "login.html"; return null; }
  opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  const r = await fetch(API + url, opts);
  if (r.status === 401) { localStorage.removeItem("jobscout_jwt"); window.location.href = "login.html"; return null; }
  return r;
}

// Show new user banner
if (new URLSearchParams(window.location.search).get("new") === "1") {
  document.getElementById("new-user-banner").classList.remove("hidden");
}

// Load user info
(async () => {
  const r = await authFetch("/api/v1/auth/me");
  if (!r) return;
  const user = await r.json();
  document.getElementById("user-email").textContent = user.email;
  document.getElementById("info-email").textContent = user.email;
  document.getElementById("info-since").textContent = new Date(user.created_at).toLocaleDateString();
  document.getElementById("key-status").textContent = user.has_api_key
    ? "✓ API key is configured"
    : "⚠ No API key set — job analysis is disabled";
})();

// Save API key
document.getElementById("btn-save-key").addEventListener("click", async () => {
  const key = document.getElementById("api-key-input").value.trim();
  const errEl = document.getElementById("api-key-error");
  const okEl = document.getElementById("api-key-success");
  errEl.classList.add("hidden"); okEl.classList.add("hidden");

  if (!key) { errEl.textContent = "Please enter an API key."; errEl.classList.remove("hidden"); return; }

  const btn = document.getElementById("btn-save-key");
  btn.disabled = true; btn.textContent = "Saving…";

  try {
    const r = await authFetch("/api/v1/auth/api-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key }),
    });
    if (!r) return;
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || "Failed to save key");
    okEl.classList.remove("hidden");
    document.getElementById("key-status").textContent = "✓ API key is configured";
    document.getElementById("api-key-input").value = "";
    // Redirect to dashboard if new user
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      setTimeout(() => { window.location.href = "dashboard.html"; }, 1200);
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
});

// Logout
document.getElementById("btn-logout").addEventListener("click", () => {
  localStorage.removeItem("jobscout_jwt");
  window.location.href = "login.html";
});
