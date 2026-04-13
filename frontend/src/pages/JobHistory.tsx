import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listHistory, patchStatus } from "@/api/history";
import { ScoreRing } from "@/components/ScoreRing";
import { StatusPill } from "@/components/StatusPill";
import { Badge } from "@/components/ui/badge";
import type { AppStatus, JobHistoryItem } from "@/types";

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

interface Filters {
  status: AppStatus | "";
  site: string;
  minScore: string;
}

function HistoryRow({ job }: { job: JobHistoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (next: AppStatus) => patchStatus(job.id, next),
    onSuccess: (updated) => {
      queryClient.setQueryData<JobHistoryItem[]>(
        ["history"],
        (prev) => prev?.map((j) => (j.id === updated.id ? updated : j)),
      );
    },
  });

  return (
    <>
      <tr
        className="border-b border-border hover:bg-surface/60 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3">
          <div className="font-medium text-text text-sm">{job.job_title}</div>
          <div className="text-muted text-xs">{job.company}</div>
        </td>
        <td className="px-4 py-3">
          <ScoreRing score={job.fit_score} size={40} />
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <StatusPill
            status={job.status as AppStatus}
            onClick={(next) => statusMutation.mutate(next)}
            disabled={statusMutation.isPending}
          />
        </td>
        <td className="px-4 py-3 text-xs text-muted">
          {job.salary_estimate?.min && job.salary_estimate?.max
            ? `$${(job.salary_estimate.min / 1000).toFixed(0)}k–$${(job.salary_estimate.max / 1000).toFixed(0)}k`
            : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-muted">
          {job.url ? new URL(job.url).hostname.replace("www.", "") : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-muted">
          {new Date(job.created_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3">
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
          <td colSpan={7} className="px-4 py-4 space-y-3">
            <p className="text-sm text-text italic">{job.one_line_verdict}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {job.direct_matches.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Direct matches</p>
                  <div className="flex flex-wrap gap-1">
                    {job.direct_matches.map((m) => (
                      <Badge key={m} variant="outline" className="border-accent text-accent text-xs">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.gaps.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Gaps</p>
                  <div className="flex flex-wrap gap-1">
                    {job.gaps.map((g) => (
                      <Badge key={g} variant="outline" className="border-danger text-danger text-xs">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {job.red_flags.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Red flags</p>
                  <div className="flex flex-wrap gap-1">
                    {job.red_flags.map((f) => (
                      <Badge key={f} variant="outline" className="border-warning text-warning text-xs">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function JobHistory() {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    status: "",
    site: "",
    minScore: "",
  });

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["history", page, filters],
    queryFn: () =>
      listHistory({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status: filters.status || undefined,
        site: filters.site || undefined,
        min_score: filters.minScore ? parseInt(filters.minScore) : undefined,
      }),
  });

  const filterSelectClass =
    "bg-surface border border-border text-text text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-text">Job History</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.status ?? ""}
            onChange={(e) => {
              setFilters((f) => ({ ...f, status: e.target.value as AppStatus | "" }));
              setPage(0);
            }}
            className={filterSelectClass}
          >
            {STATUSES.map((s) => (
              <option key={s.value ?? "null"} value={s.value ?? ""}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={filters.site}
            onChange={(e) => {
              setFilters((f) => ({ ...f, site: e.target.value }));
              setPage(0);
            }}
            className={filterSelectClass}
          >
            <option value="">All sites</option>
            {SITES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Min score"
            value={filters.minScore}
            onChange={(e) => {
              setFilters((f) => ({ ...f, minScore: e.target.value }));
              setPage(0);
            }}
            className={`${filterSelectClass} w-28`}
          />
        </div>
      </div>

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
                  {["Job", "Score", "Status", "Salary", "Site", "Date", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
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
            <span>
              Page {page + 1} · {jobs.length} results
            </span>
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
