const API = "";
const STATUS_CYCLE = [null, "applied", "phone_screen", "interviewed", "offer", "rejected"];
const STATUS_LABELS = { applied: "Applied", phone_screen: "Phone Screen", interviewed: "Interviewed", offer: "Offer", rejected: "Rejected" };

let allJobs = [];
let activeFilter = "all";
let sortCol = "score";
let sortAsc = false;
let expandedId = null;

function getToken() { return localStorage.getItem("jobscout_jwt"); }

async function authFetch(url, opts = {}) {
  const token = getToken();
  if (!token) { window.location.href = "login.html"; return null; }
  opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) };
  const r = await fetch(API + url, opts);
  if (r.status === 401) { localStorage.removeItem("jobscout_jwt"); window.location.href = "login.html"; return null; }
  return r;
}

function scoreCls(s) { return s >= 70 ? "score-high" : s >= 50 ? "score-mid" : "score-low"; }

function statusBadgeHtml(status) {
  const cls = `status-badge status-${status ?? "null"}`;
  const label = STATUS_LABELS[status] ?? "Track…";
  return `<span class="${cls}" data-status="${status ?? ""}">${label}</span>`;
}

function salaryText(est) {
  if (!est) return "—";
  const lo = est.low ? `$${Math.round(est.low / 1000)}k` : "";
  const hi = est.high ? `$${Math.round(est.high / 1000)}k` : "";
  return lo && hi ? `${lo}–${hi}` : lo || hi || "—";
}

function siteFromUrl(url) {
  if (!url) return "—";
  if (url.includes("linkedin")) return "LinkedIn";
  if (url.includes("indeed")) return "Indeed";
  if (url.includes("hiring.cafe")) return "Hiring.cafe";
  return new URL(url).hostname.replace("www.", "");
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getFiltered() {
  let jobs = [...allJobs];
  const q = document.getElementById("search").value.toLowerCase();
  if (q) jobs = jobs.filter(j => (j.job_title + j.company).toLowerCase().includes(q));
  if (activeFilter !== "all") jobs = jobs.filter(j => j.status === activeFilter);
  jobs.sort((a, b) => {
    let va, vb;
    if (sortCol === "score") { va = a.fit_score; vb = b.fit_score; }
    else if (sortCol === "date") { va = new Date(a.created_at); vb = new Date(b.created_at); }
    else if (sortCol === "status") { va = STATUS_CYCLE.indexOf(a.status); vb = STATUS_CYCLE.indexOf(b.status); }
    else { va = a.job_title.toLowerCase(); vb = b.job_title.toLowerCase(); }
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  return jobs;
}

function renderStats() {
  const counts = { applied: 0, phone_screen: 0, interviewed: 0, offer: 0, rejected: 0 };
  allJobs.forEach(j => { if (j.status && counts[j.status] !== undefined) counts[j.status]++; });
  document.getElementById("stat-total").textContent = allJobs.length;
  Object.keys(counts).forEach(k => {
    const el = document.getElementById(`stat-${k}`);
    if (el) el.textContent = counts[k];
  });
}

function renderTable() {
  const jobs = getFiltered();
  const tbody = document.getElementById("job-tbody");
  const empty = document.getElementById("empty-state");

  if (jobs.length === 0) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = jobs.map(j => `
    <tr class="job-row" data-id="${j.id}">
      <td><div class="score-badge ${scoreCls(j.fit_score)}">${j.fit_score}</div></td>
      <td class="job-title-cell">
        <div class="job-title-text" title="${escHtml(j.job_title)}">${escHtml(j.job_title)}</div>
        <div class="job-company">${escHtml(j.company)} · <span class="site-badge">${siteFromUrl(j.url)}</span></div>
      </td>
      <td class="salary-text">${salaryText(j.salary_estimate)}</td>
      <td>${statusBadgeHtml(j.status)}</td>
      <td class="date-text">${fmtDate(j.created_at)}</td>
      <td style="font-size:18px">${j.should_apply ? "✅" : "❌"}</td>
    </tr>
    <tr class="detail-row" id="detail-${j.id}" style="display:none">
      <td colspan="6">${renderDetail(j)}</td>
    </tr>
  `).join("");

  // Row expand/collapse
  tbody.querySelectorAll(".job-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".status-badge")) return;
      const id = parseInt(row.dataset.id);
      const detailRow = document.getElementById(`detail-${id}`);
      if (expandedId === id) {
        detailRow.style.display = "none";
        expandedId = null;
      } else {
        if (expandedId !== null) {
          const prev = document.getElementById(`detail-${expandedId}`);
          if (prev) prev.style.display = "none";
        }
        detailRow.style.display = "table-row";
        expandedId = id;
      }
    });
  });

  // Status badge click
  tbody.querySelectorAll(".status-badge").forEach(badge => {
    badge.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = badge.closest("tr.job-row");
      const id = parseInt(row.dataset.id);
      const job = allJobs.find(j => j.id === id);
      if (!job) return;

      const currentIdx = STATUS_CYCLE.indexOf(job.status);
      const nextStatus = STATUS_CYCLE[(currentIdx + 1) % STATUS_CYCLE.length];
      const appliedDate = nextStatus === "applied" ? new Date().toISOString() : undefined;

      badge.textContent = "…";
      const r = await authFetch(`/api/v1/job/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, ...(appliedDate ? { applied_date: appliedDate } : {}) }),
      });
      if (!r) return;
      if (r.ok) {
        job.status = nextStatus;
        renderTable();
        renderStats();
      }
    });
  });
}

function renderDetail(j) {
  const section = (title, items, type) => {
    if (!items?.length) return "";
    const lis = type === "list"
      ? items.map(i => `<li>${escHtml(i)}</li>`).join("")
      : items.map(i => `<div class="${type}-item"><div class="label">${escHtml(i.item || i.gap || "")}</div><div class="desc">${escHtml(i.detail || i.strategy || "")}</div></div>`).join("");
    return `<div class="detail-section"><h4>${title}</h4>${type === "list" ? `<ul>${lis}</ul>` : lis}</div>`;
  };

  const verdictSection = `<div class="detail-section"><h4>Verdict</h4><p style="font-size:13px">${escHtml(j.one_line_verdict)}</p></div>`;
  return `<div class="detail-grid">
    ${verdictSection}
    ${section("Direct Matches", j.direct_matches, "match")}
    ${section("Transferable", j.transferable, "match")}
    ${section("Gaps", j.gaps, "gap")}
    ${section("Green Flags", j.green_flags, "list")}
    ${section("Red Flags", j.red_flags, "list")}
  </div>`;
}

function escHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Stats filter
document.getElementById("stats-bar").addEventListener("click", (e) => {
  const item = e.target.closest(".stat-item");
  if (!item) return;
  const filter = item.dataset.filter;
  if (activeFilter === filter && filter !== "all") {
    activeFilter = "all";
    document.querySelectorAll(".stat-item").forEach(el => el.classList.toggle("active", el.dataset.filter === "all"));
  } else {
    activeFilter = filter;
    document.querySelectorAll(".stat-item").forEach(el => el.classList.toggle("active", el.dataset.filter === filter));
  }
  renderTable();
});

// Search
document.getElementById("search").addEventListener("input", renderTable);

// Sort
document.getElementById("sort-col").addEventListener("change", (e) => { sortCol = e.target.value; renderTable(); });
document.getElementById("btn-sort-dir").addEventListener("click", () => {
  sortAsc = !sortAsc;
  document.getElementById("btn-sort-dir").textContent = sortAsc ? "↑" : "↓";
  renderTable();
});

// Logout
document.getElementById("btn-logout").addEventListener("click", () => {
  localStorage.removeItem("jobscout_jwt");
  window.location.href = "login.html";
});

// Init
(async () => {
  const token = getToken();
  if (!token) { window.location.href = "login.html"; return; }

  // Load user info
  const meR = await authFetch("/api/v1/auth/me");
  if (!meR) return;
  const user = await meR.json();
  document.getElementById("user-email").textContent = user.email;
  if (!user.has_api_key) document.getElementById("no-key-banner").classList.remove("hidden");

  // Load jobs
  const r = await authFetch("/api/v1/history?limit=500");
  if (!r) return;
  allJobs = await r.json();
  renderStats();
  renderTable();
})();
