console.log("[JobScout Dashboard] Loaded");

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

interface StoredScore {
  result: AnalyzeResponse;
  jobTitle: string;
  company: string;
  timestamp: number;
  salary?: string;
  easyApply?: boolean;
  jobAge?: string;
  jobAgeIsOld?: boolean;
  url?: string;
}

interface DashboardJob {
  jobId: string;
  jobTitle: string;
  company: string;
  score: number;
  shouldApply: boolean;
  verdict: string;
  salary: string | null;
  salaryEstimate: SalaryEstimate | null;
  site: string;
  timestamp: number;
  applied: boolean;
  result: AnalyzeResponse;
  url: string | null;
}

let allJobs: DashboardJob[] = [];
let sortCol = "score";
let sortAsc = false;
let expandedJobId: string | null = null;

function detectSite(jobId: string): string {
  if (jobId.startsWith("hc_")) return "hiring-cafe";
  if (/^\d+$/.test(jobId)) return "linkedin";
  return "indeed";
}

function formatSalary(job: DashboardJob): string {
  if (job.salary) return job.salary;
  if (job.salaryEstimate) {
    const low = Math.round(job.salaryEstimate.low / 1000);
    const high = Math.round(job.salaryEstimate.high / 1000);
    return `~$${low}k–$${high}k`;
  }
  return "—";
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getScoreStyle(score: number): {
  bg: string;
  text: string;
  border: string;
} {
  if (score >= 80) return { bg: "#052e16", text: "#4ade80", border: "#166534" };
  if (score >= 60) return { bg: "#1c1917", text: "#facc15", border: "#854d0e" };
  if (score >= 40) return { bg: "#1c0a00", text: "#fb923c", border: "#9a3412" };
  return { bg: "#2d1515", text: "#f87171", border: "#7f1d1d" };
}

function getSiteBadgeClass(site: string): string {
  if (site === "linkedin") return "site-badge linkedin";
  if (site === "indeed") return "site-badge indeed";
  if (site === "hiring-cafe") return "site-badge hiring-cafe";
  return "site-badge";
}

function getSiteLabel(site: string): string {
  if (site === "linkedin") return "LinkedIn";
  if (site === "indeed") return "Indeed";
  if (site === "hiring-cafe") return "Hiring.cafe";
  return site;
}

function openAndHighlightHC(jobId: string, url: string): void {
  chrome.tabs.query({ url: "https://hiring.cafe/*" }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(tabs[0].windowId!, { focused: true });

      // Poll for card — may not be in DOM yet due to virtual scroll
      let attempts = 0;
      const maxAttempts = 20;
      const poll = setInterval(() => {
        attempts++;
        chrome.tabs.sendMessage(
          tabId,
          { type: "HIGHLIGHT_HC_CARD", jobId },
          (response) => {
            if (chrome.runtime.lastError) {
              clearInterval(poll);
              return;
            }
            if (response?.found) {
              clearInterval(poll);
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              // Card never appeared — navigate to stored URL
              chrome.tabs.update(tabId, { url }, () => {
                chrome.tabs.onUpdated.addListener(
                  function listener(updatedId, info) {
                    if (updatedId === tabId && info.status === "complete") {
                      chrome.tabs.onUpdated.removeListener(listener);
                      setTimeout(() => {
                        chrome.tabs.sendMessage(tabId, {
                          type: "HIGHLIGHT_HC_CARD",
                          jobId,
                        });
                      }, 1500);
                    }
                  },
                );
              });
            } else {
              // Scroll down to trigger lazy load
              chrome.tabs.sendMessage(tabId, { type: "SCROLL_TO_LOAD" });
            }
          },
        );
      }, 500);
    } else {
      // No hiring.cafe tab open — create one then poll same as scenario 1
      chrome.tabs.create({ url }, (tab) => {
        if (!tab.id) return;
        const tabId = tab.id;
        chrome.tabs.onUpdated.addListener(function listener(updatedId, info) {
          if (updatedId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            // Wait for initial render then start polling
            setTimeout(() => {
              let attempts = 0;
              const maxAttempts = 20;
              const poll = setInterval(() => {
                attempts++;
                chrome.tabs.sendMessage(
                  tabId,
                  { type: "HIGHLIGHT_HC_CARD", jobId },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      clearInterval(poll);
                      return;
                    }
                    if (response?.found) {
                      clearInterval(poll);
                    } else if (attempts >= maxAttempts) {
                      clearInterval(poll);
                    } else {
                      chrome.tabs.sendMessage(tabId, {
                        type: "SCROLL_TO_LOAD",
                      });
                    }
                  },
                );
              }, 500);
            }, 1500);
          }
        });
      });
    }
  });
}

function loadJobs(): void {
  chrome.storage.local.get(null, (data) => {
    const appliedKeys = new Set(
      Object.keys(data)
        .filter((k) => k.startsWith("applied_"))
        .map((k) => k.replace("applied_", "")),
    );

    allJobs = Object.entries(data)
      .filter(([key]) => key.startsWith("score_jobid_"))
      .map(([key, val]) => {
        const stored = val as StoredScore;
        const jobId = key.replace("score_jobid_", "");
        return {
          jobId,
          jobTitle: stored.jobTitle ?? "Unknown",
          company: stored.company ?? "Unknown",
          score: stored.result?.fit_score ?? 0,
          shouldApply: stored.result?.should_apply ?? false,
          verdict: stored.result?.one_line_verdict ?? "",
          salary: stored.salary ?? null,
          salaryEstimate: stored.result?.salary_estimate ?? null,
          site: detectSite(jobId),
          timestamp: stored.timestamp ?? 0,
          applied: appliedKeys.has(jobId),
          result: stored.result,
          url: stored.url ?? null,
        };
      })
      .filter((j) => j.jobTitle && j.score !== undefined);

    renderStats();
    renderTable();
    updateCount();
  });
}

function renderStats(): void {
  const bar = document.getElementById("stats-bar");
  if (!bar) return;

  const total = allJobs.length;
  const shouldApply = allJobs.filter((j) => j.shouldApply).length;
  const applied = allJobs.filter((j) => j.applied).length;
  const avgScore =
    total > 0
      ? Math.round(allJobs.reduce((s, j) => s + j.score, 0) / total)
      : 0;
  const high = allJobs.filter((j) => j.score >= 70).length;

  bar.innerHTML = `
    <div class="stat">
      <span class="stat-value">${total}</span>
      <span class="stat-label">Jobs Scored</span>
    </div>
    <div class="stat">
      <span class="stat-value green">${shouldApply}</span>
      <span class="stat-label">Apply Recs</span>
    </div>
    <div class="stat">
      <span class="stat-value yellow">${high}</span>
      <span class="stat-label">Score ≥70</span>
    </div>
    <div class="stat">
      <span class="stat-value">${avgScore}</span>
      <span class="stat-label">Avg Score</span>
    </div>
    <div class="stat">
      <span class="stat-value" style="color:#38bdf8">${applied}</span>
      <span class="stat-label">Applied</span>
    </div>
  `;
}

function getFilteredJobs(): DashboardJob[] {
  const search =
    (
      document.getElementById("search") as HTMLInputElement
    )?.value.toLowerCase() ?? "";
  const site =
    (document.getElementById("filter-site") as HTMLSelectElement)?.value ??
    "all";
  const minScore = parseInt(
    (document.getElementById("filter-score") as HTMLInputElement)?.value ?? "0",
  );
  const applyFilter =
    (document.getElementById("filter-apply") as HTMLSelectElement)?.value ??
    "all";
  const appliedFilter =
    (document.getElementById("filter-applied") as HTMLSelectElement)?.value ??
    "all";

  return allJobs
    .filter((j) => {
      if (
        search &&
        !j.jobTitle.toLowerCase().includes(search) &&
        !j.company.toLowerCase().includes(search)
      )
        return false;
      if (site !== "all" && j.site !== site) return false;
      if (j.score < minScore) return false;
      if (applyFilter === "yes" && !j.shouldApply) return false;
      if (applyFilter === "no" && j.shouldApply) return false;
      if (appliedFilter === "yes" && !j.applied) return false;
      if (appliedFilter === "no" && j.applied) return false;
      return true;
    })
    .sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortCol === "score") {
        av = a.score;
        bv = b.score;
      } else if (sortCol === "title") {
        av = a.jobTitle;
        bv = b.jobTitle;
      } else if (sortCol === "company") {
        av = a.company;
        bv = b.company;
      } else if (sortCol === "date") {
        av = a.timestamp;
        bv = b.timestamp;
      } else if (sortCol === "site") {
        av = a.site;
        bv = b.site;
      } else if (sortCol === "apply") {
        av = a.shouldApply ? 1 : 0;
        bv = b.shouldApply ? 1 : 0;
      } else if (sortCol === "applied") {
        av = a.applied ? 1 : 0;
        bv = b.applied ? 1 : 0;
      }

      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
}

function renderTable(): void {
  const tbody = document.getElementById("job-tbody");
  const emptyState = document.getElementById("empty-state");
  if (!tbody || !emptyState) return;

  const jobs = getFilteredJobs();

  if (jobs.length === 0) {
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  tbody.innerHTML = "";

  jobs.forEach((job) => {
    const { bg, text, border } = getScoreStyle(job.score);
    const salary = formatSalary(job);
    const isExpanded = expandedJobId === job.jobId;

    const tr = document.createElement("tr");
    tr.setAttribute("data-job-id", job.jobId);
    tr.innerHTML = `
      <td>
        <button class="expand-btn" data-job-id="${job.jobId}" title="${isExpanded ? "Collapse" : "Expand"}">${isExpanded ? "▲" : "▼"}</button>
      </td>
      <td>
        <div class="score-pill" style="background:${bg};color:${text};border:1px solid ${border}">${job.score}</div>
      </td>
      <td>
        <div class="job-title" title="${job.jobTitle}">
          ${
            job.url
              ? `<a href="${job.url}" target="_blank"
                class="job-title-link"
                data-job-id="${job.jobId}"
                data-site="${job.site}"
                data-url="${job.url}"
                style="color:#e2e8f0;text-decoration:none;cursor:pointer;"
                onmouseover="this.style.color='#38bdf8'"
                onmouseout="this.style.color='#e2e8f0'">${job.jobTitle}</a>`
              : job.jobTitle
          }
        </div>
        <div class="company">${job.company}</div>
      </td>
      <td class="company">${job.company}</td>
      <td class="salary-cell">${salary}</td>
      <td><span class="${getSiteBadgeClass(job.site)}">${getSiteLabel(job.site)}</span></td>
      <td><span class="apply-pill ${job.shouldApply ? "yes" : "no"}">${job.shouldApply ? "✓ Apply" : "✗ Skip"}</span></td>
      <td style="text-align:center">
        <input type="checkbox" class="applied-check" data-job-id="${job.jobId}" ${job.applied ? "checked" : ""} title="Mark as applied" />
      </td>
      <td class="date-cell">${formatDate(job.timestamp)}</td>
    `;
    tbody.appendChild(tr);

    if (isExpanded) {
      const detailTr = document.createElement("tr");
      detailTr.className = "detail-row";
      detailTr.innerHTML = `
        <td colspan="9">
          <div style="font-size:12px;color:#94a3b8;font-style:italic;margin-bottom:12px">${job.verdict}</div>
          <div class="detail-grid">
            <div class="detail-section green">
              <h4>✓ Direct Matches (${job.result.direct_matches?.length ?? 0})</h4>
              <ul>
                ${(job.result.direct_matches ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}
              </ul>
            </div>
            <div class="detail-section">
              <h4>↔ Transferable (${job.result.transferable?.length ?? 0})</h4>
              <ul>
                ${(job.result.transferable ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}
              </ul>
            </div>
            <div class="detail-section red">
              <h4>✗ Gaps (${job.result.gaps?.length ?? 0})</h4>
              <ul>
                ${(job.result.gaps ?? []).map((m) => `<li>${m.item} — ${m.detail}</li>`).join("") || "<li>None</li>"}
              </ul>
            </div>
          </div>
          ${
            job.result.green_flags?.length || job.result.red_flags?.length
              ? `
          <div class="detail-grid" style="margin-top:12px">
            <div class="detail-section green">
              <h4>🟢 Green Flags</h4>
              <ul>${(job.result.green_flags ?? []).map((f) => `<li>${f}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            <div class="detail-section red">
              <h4>🔴 Red Flags</h4>
              <ul>${(job.result.red_flags ?? []).map((f) => `<li>${f}</li>`).join("") || "<li>None</li>"}</ul>
            </div>
            ${
              job.result.salary_estimate
                ? `
            <div class="detail-section">
              <h4>💰 Salary Estimate</h4>
              <ul>
                <li>$${Math.round(job.result.salary_estimate.low / 1000)}k – $${Math.round(job.result.salary_estimate.high / 1000)}k/yr</li>
                <li>Confidence: ${job.result.salary_estimate.confidence}</li>
                ${job.result.salary_estimate.assessment ? `<li>${job.result.salary_estimate.assessment}</li>` : ""}
              </ul>
            </div>`
                : "<div></div>"
            }
          </div>`
              : ""
          }
        </td>
      `;
      tbody.appendChild(detailTr);
    }
  });

  // Expand/collapse listeners
  tbody.querySelectorAll(".expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const jobId = (btn as HTMLElement).getAttribute("data-job-id")!;
      expandedJobId = expandedJobId === jobId ? null : jobId;
      renderTable();
    });
  });

  // Applied checkbox listeners
  tbody.querySelectorAll(".applied-check").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const checkbox = e.target as HTMLInputElement;
      const jobId = checkbox.getAttribute("data-job-id")!;
      const isChecked = checkbox.checked;

      if (isChecked) {
        chrome.storage.local.set({ [`applied_${jobId}`]: true });
        chrome.runtime.sendMessage({ type: "MARK_APPLIED", jobId });
      } else {
        chrome.storage.local.remove(`applied_${jobId}`);
      }

      const job = allJobs.find((j) => j.jobId === jobId);
      if (job) job.applied = isChecked;
      renderStats();
    });
  });

  // Intercept hiring.cafe links for smart highlight
  tbody
    .querySelectorAll<HTMLAnchorElement>(".job-title-link")
    .forEach((link) => {
      link.addEventListener("click", (e) => {
        const site = link.getAttribute("data-site");
        if (site === "hiring-cafe") {
          e.preventDefault();
          const jobId = link.getAttribute("data-job-id")!;
          const url = link.getAttribute("data-url")!;
          openAndHighlightHC(jobId, url);
        }
        // LinkedIn/Indeed open normally via href
      });
    });
}

function updateCount(): void {
  const countEl = document.getElementById("job-count");
  if (countEl) {
    const filtered = getFilteredJobs().length;
    countEl.textContent =
      filtered === allJobs.length
        ? `${allJobs.length} jobs scored`
        : `${filtered} of ${allJobs.length} jobs`;
  }
}

function exportCSV(): void {
  const jobs = getFilteredJobs();
  const headers = [
    "Score",
    "Job Title",
    "Company",
    "Salary",
    "Site",
    "Recommend",
    "Applied",
    "Verdict",
    "Analyzed",
    "URL",
  ];
  const rows = jobs.map((j) => [
    j.score,
    `"${j.jobTitle.replace(/"/g, '""')}"`,
    `"${j.company.replace(/"/g, '""')}"`,
    `"${formatSalary(j)}"`,
    getSiteLabel(j.site),
    j.shouldApply ? "Apply" : "Skip",
    j.applied ? "Yes" : "No",
    `"${j.verdict.replace(/"/g, '""')}"`,
    new Date(j.timestamp).toLocaleDateString(),
    j.url ? `"${j.url}"` : "",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobscout-history-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Controls
document.getElementById("search")?.addEventListener("input", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-site")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-score")?.addEventListener("input", (e) => {
  const val = (e.target as HTMLInputElement).value;
  const el = document.getElementById("score-val");
  if (el) el.textContent = `${val}+`;
  renderTable();
  updateCount();
});
document.getElementById("filter-apply")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});
document.getElementById("filter-applied")?.addEventListener("change", () => {
  renderTable();
  updateCount();
});

document.getElementById("btn-export")?.addEventListener("click", exportCSV);

document.getElementById("btn-clear")?.addEventListener("click", () => {
  if (!confirm("Clear all scored job history? This cannot be undone.")) return;
  chrome.storage.local.get(null, (data) => {
    const toRemove = Object.keys(data).filter(
      (k) => k.startsWith("score_jobid_") || k.startsWith("jobid_"),
    );
    chrome.storage.local.remove(toRemove, () => {
      allJobs = [];
      renderStats();
      renderTable();
      updateCount();
    });
  });
});

// Sort headers
document.querySelectorAll("thead th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-col")!;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col === "title" || col === "company";
    }
    document
      .querySelectorAll("thead th")
      .forEach((t) => t.classList.remove("sorted"));
    th.classList.add("sorted");
    th.textContent =
      th.textContent!.replace(" ↑", "").replace(" ↓", "") +
      (sortAsc ? " ↑" : " ↓");
    renderTable();
  });
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = (btn as HTMLElement).getAttribute("data-tab")!;
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`)?.classList.add("active");
    if (tab === "filters") renderFilters();
    if (tab === "history") {
      renderTable();
      updateCount();
    }
  });
});

// Render whichever tab is active on load
const activeTab = document
  .querySelector(".tab-btn.active")
  ?.getAttribute("data-tab");
if (activeTab === "filters") renderFilters();

function renderFilters(): void {
  renderHiddenJobs();
  renderLearnedKeywords();
}

function renderHiddenJobs(): void {
  const container = document.getElementById("hidden-jobs-list");
  if (!container) return;

  chrome.storage.local.get(null, (data) => {
    const hiddenKeys = Object.keys(data).filter((k) =>
      k.startsWith("user_dimmed_"),
    );

    if (hiddenKeys.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px">No manually hidden jobs.</div>`;
      return;
    }

    // Get score entries to match titles
    const jobIds = hiddenKeys.map((k) => k.replace("user_dimmed_", ""));
    const scoreKeys = jobIds.map((id) => `score_jobid_${id}`);

    chrome.storage.local.get(scoreKeys, (scores) => {
      container.innerHTML = "";
      jobIds.forEach((jobId, i) => {
        const scoreEntry = scores[`score_jobid_${jobId}`] as
          | { jobTitle?: string; company?: string }
          | undefined;
        const title = scoreEntry?.jobTitle ?? jobId;
        const company = scoreEntry?.company ?? "Unknown company";

        const row = document.createElement("div");
        row.className = "filter-row";
        row.innerHTML = `
          <div class="filter-row-info">
            <div class="filter-row-title">${title}</div>
            <div class="filter-row-meta">${company}</div>
          </div>
          <div class="filter-row-actions">
            <button class="btn-unhide" data-job-id="${jobId}">👁 Show</button>
          </div>
        `;
        container.appendChild(row);

        row.querySelector(".btn-unhide")?.addEventListener("click", () => {
          chrome.storage.local.remove(`user_dimmed_${jobId}`, () => {
            chrome.storage.local.set({ [`user_undimmed_${jobId}`]: true });
            row.remove();
            if (container.children.length === 0) {
              container.innerHTML = `<div class="empty-state" style="padding:20px">No manually hidden jobs.</div>`;
            }
          });
        });
      });
    });
  });
}

function renderLearnedKeywords(): void {
  const container = document.getElementById("learned-keywords-list");
  if (!container) return;

  chrome.storage.local.get(null, (data) => {
    const hideKeys = Object.keys(data).filter((k) => k.startsWith("kw_hide_"));

    if (hideKeys.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:20px">No learned keywords yet.</div>`;
      return;
    }

    const ngrams = hideKeys.map((k) => k.replace("kw_hide_", ""));
    const showKeys = ngrams.map((ng) => `kw_show_${ng}`);

    chrome.storage.local.get(showKeys, (showData) => {
      const entries = ngrams
        .map((ng) => {
          const hideCount = (data[`kw_hide_${ng}`] as number) ?? 0;
          const showCount = (showData[`kw_show_${ng}`] as number) ?? 0;
          const total = hideCount + showCount;
          const confidence = total > 0 ? hideCount / total : 0;
          return { ng, hideCount, showCount, confidence };
        })
        .sort(
          (a, b) => b.confidence - a.confidence || b.hideCount - a.hideCount,
        );

      container.innerHTML = "";
      entries.forEach(({ ng, hideCount, showCount, confidence }) => {
        const isActive = hideCount >= 3 && confidence >= 0.7;
        const pct = Math.round(confidence * 100);

        const row = document.createElement("div");
        row.className = "filter-row";
        row.innerHTML = `
          <div class="filter-row-info">
            <div class="filter-row-title">
              <span class="kw-tag">${ng}</span>
              ${isActive ? `<span style="margin-left:8px;font-size:10px;color:#f87171">● auto-dimming</span>` : `<span style="margin-left:8px;font-size:10px;color:#475569">building signal</span>`}
            </div>
            <div class="filter-row-meta">${hideCount} hides · ${showCount} shows · ${pct}% dim confidence</div>
          </div>
          <div class="filter-row-actions">
            <div class="confidence-bar-wrap">
              <div class="confidence-bar" style="width:${pct}%;opacity:${isActive ? 1 : 0.4}"></div>
            </div>
            <button class="btn-reset-kw" data-ng="${ng}">Reset</button>
          </div>
        `;
        container.appendChild(row);

        row.querySelector(".btn-reset-kw")?.addEventListener("click", () => {
          chrome.storage.local.remove(
            [`kw_hide_${ng}`, `kw_show_${ng}`],
            () => {
              row.remove();
              if (container.children.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding:20px">No learned keywords yet.</div>`;
              }
            },
          );
        });
      });
    });
  });
}
// Load data
loadJobs();
