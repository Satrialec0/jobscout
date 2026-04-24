import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listHistory, patchStatus, getStats, getJobDetail } from "@/api/history";
import { listProfiles, getActiveProfile } from "@/api/profiles";
import { ScoreRing } from "@/components/ScoreRing";
import { StatusPill } from "@/components/StatusPill";
import { Badge } from "@/components/ui/badge";
import type { AppStatus, JobHistoryItem, ScoreCategory } from "@/types";
import type { HistoryStats } from "@/api/history";

const PAGE_SIZE = 25;

const SITES = ["", "linkedin", "indeed", "hiring.cafe"];
const STATUSES: Array<{ value: AppStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "applied", label: "Applied" },
  { value: "phone_screen", label: "Phone Screen" },
  { value: "interviewed", label: "Interviewed" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
];
const APPLIED_WITHIN = [
  { value: "", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

interface Filters {
  search: string;
  status: AppStatus | "";
  site: string;
  minScore: number;
  recommend: "" | "true" | "false";
  applied: "" | "true" | "false";
  days: string;
  profileId: string;
}

const DEFAULT_FILTERS: Filters = {
  search: "",
  status: "",
  site: "",
  minScore: 0,
  recommend: "",
  applied: "",
  days: "",
  profileId: "",
};

// ── Funnel ───────────────────────────────────────────────────────────────────

function FunnelBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-right text-muted">{label}</span>
      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-5 text-muted">{count}</span>
    </div>
  );
}

// ── Stats bar ────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string | number;
  color?: string;
  onClick?: () => void;
  active?: boolean;
}

function StatTile({ label, value, color = "text-text", onClick, active }: StatTileProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${
        active ? "bg-accent/10 ring-1 ring-accent" : "hover:bg-surface/60"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <span className={`text-xl font-bold ${color}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted mt-0.5">{label}</span>
    </button>
  );
}

function StatsBar({
  stats,
  filters,
  setFilters,
  setPage,
}: {
  stats: HistoryStats;
  filters: Filters;
  setFilters: (f: Filters) => void;
  setPage: (n: number) => void;
}) {
  const toggle = useCallback(
    (patch: Partial<Filters>) => {
      setFilters({ ...DEFAULT_FILTERS, profileId: filters.profileId, ...patch });
      setPage(0);
    },
    [filters.profileId, setFilters, setPage],
  );

  const funnelMax = Math.max(stats.applied, 1);

  return (
    <div className="flex items-stretch gap-0 flex-wrap bg-surface border border-border rounded-lg px-2 py-1">
      {/* stat tiles */}
      <StatTile label="Scored" value={stats.total} />
      <div className="w-px bg-border mx-1 self-stretch" />
      <StatTile
        label="Apply Recs"
        value={stats.recs}
        color="text-accent"
        onClick={() => toggle({ recommend: filters.recommend === "true" ? "" : "true" })}
        active={filters.recommend === "true"}
      />
      <StatTile
        label="Score ≥70"
        value={stats.high_score}
        color="text-accent"
        onClick={() => toggle({ minScore: filters.minScore === 70 ? 0 : 70 })}
        active={filters.minScore === 70}
      />
      <StatTile label="Avg Score" value={stats.avg_score} />
      <div className="w-px bg-border mx-1 self-stretch" />
      <StatTile
        label="Applied"
        value={stats.applied}
        color="text-blue-400"
        onClick={() => toggle({ status: filters.status === "applied" ? "" : "applied" })}
        active={filters.status === "applied"}
      />
      <StatTile
        label="Phone Screen"
        value={stats.phone_screen}
        color="text-yellow-400"
        onClick={() => toggle({ status: filters.status === "phone_screen" ? "" : "phone_screen" })}
        active={filters.status === "phone_screen"}
      />
      <StatTile
        label="Interviewed"
        value={stats.interviewed}
        color="text-purple-400"
        onClick={() => toggle({ status: filters.status === "interviewed" ? "" : "interviewed" })}
        active={filters.status === "interviewed"}
      />
      <StatTile
        label="Offers"
        value={stats.offer}
        color="text-accent"
        onClick={() => toggle({ status: filters.status === "offer" ? "" : "offer" })}
        active={filters.status === "offer"}
      />
      <StatTile
        label="Rejected"
        value={stats.rejected}
        color="text-danger"
        onClick={() => toggle({ status: filters.status === "rejected" ? "" : "rejected" })}
        active={filters.status === "rejected"}
      />
      <div className="w-px bg-border mx-1 self-stretch" />
      <StatTile label="Response Rate" value={`${stats.response_rate}%`} />
      <StatTile label="Offer Rate" value={`${stats.offer_rate}%`} color={stats.offer_rate > 0 ? "text-accent" : "text-text"} />

      {/* funnel */}
      <div className="flex-1 min-w-[180px] ml-4 flex flex-col justify-center gap-1 py-1">
        <FunnelBar label="Applied" count={stats.applied} max={funnelMax} />
        <FunnelBar label="Screen" count={stats.phone_screen} max={funnelMax} />
        <FunnelBar label="Interview" count={stats.interviewed} max={funnelMax} />
        <FunnelBar label="Offer" count={stats.offer} max={funnelMax} />
      </div>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function HistoryRow({ job }: { job: JobHistoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ["job-detail", job.id],
    queryFn: () => getJobDetail(job.id),
    enabled: expanded,
    staleTime: Infinity,
  });

  const statusMutation = useMutation({
    mutationFn: (next: AppStatus) => patchStatus(job.id, next),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["history"] });
      queryClient.invalidateQueries({ queryKey: ["history-stats"] });
    },
  });

  const displayStatus = statusMutation.isPending
    ? (statusMutation.variables as AppStatus)
    : (job.status as AppStatus);

  return (
    <>
      <tr
        className="border-b border-border hover:bg-surface/60 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-2">
          <ScoreRing score={job.fit_score} size={38} />
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-text text-sm">{job.job_title}</div>
          <div className="text-muted text-xs">{job.company}</div>
        </td>
        <td className="px-3 py-2 text-center">
          <span
            className={`text-xs font-bold ${job.should_apply ? "text-accent" : "text-muted"}`}
          >
            {job.should_apply ? "✓" : "—"}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-muted">
          {job.salary_estimate?.low && job.salary_estimate?.high
            ? `$${(job.salary_estimate.low / 1000).toFixed(0)}k–$${(job.salary_estimate.high / 1000).toFixed(0)}k`
            : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-muted">
          {job.url ? new URL(job.url).hostname.replace("www.", "") : "—"}
        </td>
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <StatusPill
            status={displayStatus}
            onClick={(next) => statusMutation.mutate(next)}
            disabled={statusMutation.isPending}
          />
        </td>
        <td className="px-3 py-2 text-xs text-muted">
          {job.applied_date ? new Date(job.applied_date).toLocaleDateString() : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-muted">
          {new Date(job.created_at).toLocaleDateString()}
        </td>
        <td className="px-3 py-2">
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-accent hover:underline"
            >
              View
            </a>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface/40 border-b border-border">
          <td colSpan={9} className="px-4 py-4 space-y-4">
            <p className="text-sm text-text italic">{job.one_line_verdict}</p>

            {/* Analysis breakdown */}
            <div className="flex flex-wrap gap-4 text-sm">
              {job.direct_matches.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Direct matches</p>
                  <div className="flex flex-wrap gap-1">
                    {job.direct_matches.map((m: ScoreCategory, i) => (
                      <Badge key={i} variant="outline" className="border-accent text-accent text-xs" title={m.detail}>{m.item}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.transferable.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Transferable</p>
                  <div className="flex flex-wrap gap-1">
                    {job.transferable.map((t: ScoreCategory, i) => (
                      <Badge key={i} variant="outline" className="border-blue-400 text-blue-400 text-xs" title={t.detail}>{t.item}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.gaps.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Gaps</p>
                  <div className="flex flex-wrap gap-1">
                    {job.gaps.map((g: ScoreCategory, i) => (
                      <Badge key={i} variant="outline" className="border-danger text-danger text-xs" title={g.detail}>{g.item}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.red_flags.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Red flags</p>
                  <div className="flex flex-wrap gap-1">
                    {job.red_flags.map((f, i) => (
                      <Badge key={i} variant="outline" className="border-warning text-warning text-xs">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.green_flags.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Green flags</p>
                  <div className="flex flex-wrap gap-1">
                    {job.green_flags.map((f, i) => (
                      <Badge key={i} variant="outline" className="border-accent/50 text-accent/70 text-xs">{f}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Job description — lazy loaded */}
            <div>
              <p className="text-xs text-muted font-medium mb-1">Job description</p>
              {detailLoading ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : detail?.job_description ? (
                <div className="max-h-72 overflow-y-auto rounded border border-border bg-bg p-3 text-xs text-text whitespace-pre-wrap leading-relaxed">
                  {detail.job_description}
                </div>
              ) : (
                <p className="text-xs text-muted">No job description stored.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function JobHistory() {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: listProfiles,
  });

  const { data: activeProfile } = useQuery({
    queryKey: ["active-profile"],
    queryFn: getActiveProfile,
  });

  // Seed the profile filter with the active profile once on load
  useEffect(() => {
    if (activeProfile?.id && filters.profileId === "") {
      setFilters((f) => ({ ...f, profileId: String(activeProfile.id) }));
    }
  }, [activeProfile]);

  const profileId = filters.profileId ? parseInt(filters.profileId) : undefined;

  const { data: stats } = useQuery({
    queryKey: ["history-stats", profileId],
    queryFn: () => getStats(profileId),
  });

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["history", page, filters],
    queryFn: () =>
      listHistory({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: filters.search || undefined,
        status: (filters.status as AppStatus) || undefined,
        site: filters.site || undefined,
        min_score: filters.minScore > 0 ? filters.minScore : undefined,
        recommend: filters.recommend !== "" ? filters.recommend === "true" : undefined,
        applied: filters.applied !== "" ? filters.applied === "true" : undefined,
        days: filters.days ? parseInt(filters.days) : undefined,
        profile_id: profileId,
      }),
  });

  const selectClass =
    "bg-surface border border-border text-text text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="p-6 space-y-3">
      {/* Stats bar */}
      {stats && (
        <StatsBar
          stats={stats}
          filters={filters}
          setFilters={setFilters}
          setPage={setPage}
        />
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Job title or company…"
          value={filters.search}
          onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(0); }}
          className={`${selectClass} w-44`}
        />
        <select
          value={filters.site}
          onChange={(e) => { setFilters({ ...filters, site: e.target.value }); setPage(0); }}
          className={selectClass}
        >
          <option value="">All sites</option>
          {SITES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Min score slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Min score</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minScore}
            onChange={(e) => { setFilters({ ...filters, minScore: parseInt(e.target.value) }); setPage(0); }}
            className="w-24 accent-accent"
          />
          <span className="text-xs text-muted w-6">{filters.minScore > 0 ? filters.minScore : "0+"}</span>
        </div>

        <select
          value={filters.recommend}
          onChange={(e) => { setFilters({ ...filters, recommend: e.target.value as Filters["recommend"] }); setPage(0); }}
          className={selectClass}
        >
          <option value="">Recommend: All</option>
          <option value="true">Recommended</option>
          <option value="false">Not recommended</option>
        </select>

        <select
          value={filters.applied}
          onChange={(e) => { setFilters({ ...filters, applied: e.target.value as Filters["applied"] }); setPage(0); }}
          className={selectClass}
        >
          <option value="">Applied: All</option>
          <option value="true">Applied</option>
          <option value="false">Not applied</option>
        </select>

        <select
          value={filters.status ?? ""}
          onChange={(e) => { setFilters({ ...filters, status: e.target.value as AppStatus | "" }); setPage(0); }}
          className={selectClass}
        >
          {STATUSES.map((s) => (
            <option key={String(s.value ?? "")} value={String(s.value ?? "")}>{s.label}</option>
          ))}
        </select>

        <select
          value={filters.days}
          onChange={(e) => { setFilters({ ...filters, days: e.target.value }); setPage(0); }}
          className={selectClass}
        >
          {APPLIED_WITHIN.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>

        {profiles && profiles.length > 1 && (
          <select
            value={filters.profileId}
            onChange={(e) => { setFilters({ ...filters, profileId: e.target.value }); setPage(0); }}
            className={selectClass}
          >
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS) && (
          <button
            onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0); }}
            className="text-xs text-muted hover:text-danger transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : !jobs?.length ? (
        <div className="rounded-lg bg-surface border border-border p-8 text-center">
          <p className="text-muted text-sm">No jobs found.</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-surface border-b border-border">
                <tr>
                  {["Score", "Job", "Rec", "Salary", "Site", "Status", "Applied", "Analyzed", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <HistoryRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Page {page + 1} · {jobs.length} results</span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded bg-surface border border-border hover:border-accent disabled:opacity-40 transition-colors"
              >
                ← Prev
              </button>
              <button
                disabled={jobs.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded bg-surface border border-border hover:border-accent disabled:opacity-40 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
