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

// ── Tab switching ──
document.querySelectorAll('.settings-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.settings-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'keyword-filters') loadBlocklist();
  });
});

// ── Keyword Filters ──
var blocklistTerms = [];

async function loadBlocklist() {
  const r = await authFetch('/api/v1/keywords/blocklist');
  if (!r) return;
  const data = await r.json();
  blocklistTerms = data.terms || [];
  renderBlocklist();
}

function renderBlocklist() {
  const list = document.getElementById('keyword-list');
  if (blocklistTerms.length === 0) {
    list.innerHTML = '<li class="keyword-item-empty">No keyword filters yet. Add one above.</li>';
    return;
  }
  list.innerHTML = blocklistTerms.map(function(term) {
    return '<li class="keyword-item"><span>' + term + '</span>'
      + '<button class="btn-remove-keyword" data-term="' + term.replace(/"/g, '&quot;') + '">\u00d7</button></li>';
  }).join('');
}

document.getElementById('btn-add-keyword').addEventListener('click', async function() {
  const input = document.getElementById('keyword-input');
  const term = input.value.trim().toLowerCase();
  const errEl = document.getElementById('keyword-error');
  errEl.classList.add('hidden');

  if (!term) return;
  if (blocklistTerms.includes(term)) {
    errEl.textContent = 'That term is already in your list.';
    errEl.classList.remove('hidden');
    return;
  }

  // Optimistic update
  blocklistTerms.unshift(term);
  renderBlocklist();
  input.value = '';

  const r = await authFetch('/api/v1/keywords/blocklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: term }),
  });
  if (!r || !r.ok) {
    blocklistTerms = blocklistTerms.filter(function(t) { return t !== term; });
    renderBlocklist();
    errEl.textContent = 'Failed to add keyword. Please try again.';
    errEl.classList.remove('hidden');
  }
});

document.getElementById('keyword-list').addEventListener('click', async function(e) {
  const btn = e.target.closest('.btn-remove-keyword');
  if (!btn) return;
  const term = btn.dataset.term;

  // Optimistic update
  var prev = blocklistTerms.slice();
  blocklistTerms = blocklistTerms.filter(function(t) { return t !== term; });
  renderBlocklist();

  const r = await authFetch('/api/v1/keywords/blocklist/' + encodeURIComponent(term), { method: 'DELETE' });
  if (!r || !r.ok) {
    blocklistTerms = prev;
    renderBlocklist();
  }
});
