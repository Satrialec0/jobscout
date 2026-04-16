import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analyzeJob, dismissJob, listScrapedJobs } from "@/api/scraped-jobs";
import { ScoreRing } from "@/components/ScoreRing";
import { Button } from "@/components/ui/button";
import type { ScrapedJob } from "@/types";
import { formatDistanceToNow } from "date-fns";

function JobCard({ job }: { job: ScrapedJob }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const dismissMutation = useMutation({
    mutationFn: () => dismissJob(job.id),
    onSuccess: () =>
      queryClient.setQueryData<ScrapedJob[]>(["scraped-jobs"], (prev) =>
        prev?.filter((j) => j.id !== job.id),
      ),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeJob(job.id),
    onSuccess: (result) => {
      queryClient.setQueryData<ScrapedJob[]>(["scraped-jobs"], (prev) =>
        prev?.map((j) =>
          j.id === job.id ? { ...j, analysis: result } : j,
        ),
      );
      setExpanded(true);
    },
  });

  const analysis = job.analysis;

  return (
    <div className="rounded-lg bg-surface border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text font-medium hover:text-accent truncate block"
          >
            {job.title}
          </a>
          <p className="text-muted text-sm">{job.company}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted">
            {job.saved_search_name && (
              <span className="bg-border rounded px-1.5 py-0.5">
                {job.saved_search_name}
              </span>
            )}
            <span>
              Found {formatDistanceToNow(new Date(job.found_at), { addSuffix: true })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {analysis && <ScoreRing score={analysis.fit_score} size={48} />}
          {!analysis && (
            <Button
              size="sm"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending}
              className="bg-accent text-background hover:bg-accent/90 text-xs"
            >
              {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
            </Button>
          )}
          <button
            onClick={() => dismissMutation.mutate()}
            disabled={dismissMutation.isPending}
            className="text-muted hover:text-danger transition-colors text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>

      {analysis && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted hover:text-text transition-colors"
          >
            {expanded ? "Hide details ▲" : "Show details ▼"}
          </button>
          {expanded && (
            <div className="space-y-2 text-sm border-t border-border pt-3">
              <p className="text-text italic">{analysis.one_line_verdict}</p>
              {analysis.direct_matches.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Direct matches</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.direct_matches.map((m) => (
                      <span key={m} className="bg-accent-dim text-accent text-xs px-2 py-0.5 rounded">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.gaps.length > 0 && (
                <div>
                  <p className="text-xs text-muted font-medium mb-1">Gaps</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.gaps.map((g) => (
                      <span key={g} className="bg-red-950 text-danger text-xs px-2 py-0.5 rounded">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.salary_estimate && (
                <p className="text-xs text-muted">
                  Salary:{" "}
                  {analysis.salary_estimate.low && analysis.salary_estimate.high
                    ? `$${analysis.salary_estimate.low.toLocaleString()} – $${analysis.salary_estimate.high.toLocaleString()}`
                    : "Not available"}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function WhileYouWereGone() {
  const { data: jobs, isLoading } = useQuery({
    queryKey: ["scraped-jobs"],
    queryFn: listScrapedJobs,
  });

  if (isLoading) {
    return (
      <div className="p-8 text-muted text-sm">Loading new jobs…</div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-text">While You Were Gone</h1>
        <p className="text-muted text-sm mt-0.5">
          {jobs?.length
            ? `${jobs.length} unread job${jobs.length === 1 ? "" : "s"} from your saved searches`
            : ""}
        </p>
      </div>
      {!jobs?.length ? (
        <div className="rounded-lg bg-surface border border-border p-8 text-center">
          <p className="text-muted text-sm">
            No new jobs since your last visit. Scraper checks every hour.
          </p>
        </div>
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} />)
      )}
    </div>
  );
}
