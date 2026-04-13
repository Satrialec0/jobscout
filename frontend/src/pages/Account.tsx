import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activateProfile, listProfiles } from "@/api/profiles";
import { deleteSearch, listSearches, patchSearch } from "@/api/searches";
import { getCredentialStatus } from "@/api/credentials";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { clsx } from "clsx";

export function Account() {
  const queryClient = useQueryClient();

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: listProfiles,
  });

  const { data: searches } = useQuery({
    queryKey: ["searches"],
    queryFn: listSearches,
  });

  const { data: credStatus } = useQuery({
    queryKey: ["credential-status"],
    queryFn: getCredentialStatus,
    refetchInterval: 60_000,
  });

  const activateMutation = useMutation({
    mutationFn: activateProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const toggleSearchMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      patchSearch(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["searches"] }),
  });

  const deleteSearchMutation = useMutation({
    mutationFn: deleteSearch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["searches"] }),
  });

  const sectionClass = "rounded-lg bg-surface border border-border p-5 space-y-4";
  const headingClass = "text-sm font-semibold text-text";

  const credLabel = !credStatus
    ? "Unknown"
    : credStatus.active
    ? `Active — last checked ${
        credStatus.last_used
          ? formatDistanceToNow(new Date(credStatus.last_used), { addSuffix: true })
          : "never"
      }`
    : credStatus.last_error?.includes("expired")
    ? "Session expired — visit hiring.cafe to refresh"
    : "Inactive";

  const credColor = !credStatus
    ? "bg-muted"
    : credStatus.active
    ? "bg-accent"
    : "bg-danger";

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-text">Account</h1>

      {/* Active profile */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Profile</h2>
        <div className="space-y-2">
          {profiles?.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-text">{profile.name}</span>
                {profile.is_active && (
                  <Badge className="bg-accent-dim text-accent text-xs">Active</Badge>
                )}
              </div>
              {!profile.is_active && (
                <button
                  onClick={() => activateMutation.mutate(profile.id)}
                  disabled={activateMutation.isPending}
                  className="text-xs text-accent hover:underline disabled:opacity-50"
                >
                  Activate
                </button>
              )}
            </div>
          ))}
          {!profiles?.length && (
            <p className="text-xs text-muted">
              No profiles. Create one via the extension.
            </p>
          )}
        </div>
      </div>

      {/* Saved searches */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Saved searches</h2>
        <p className="text-xs text-muted">
          To add a search, visit hiring.cafe with the extension active and click
          &quot;Watch this search&quot;.
        </p>
        <div className="space-y-2">
          {searches?.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <div>
                <p className="text-sm text-text">{s.name}</p>
                <p className="text-xs text-muted">
                  {s.last_polled
                    ? `Last polled ${formatDistanceToNow(new Date(s.last_polled), { addSuffix: true })}`
                    : "Not yet polled"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    toggleSearchMutation.mutate({
                      id: s.id,
                      is_active: !s.is_active,
                    })
                  }
                  disabled={toggleSearchMutation.isPending}
                  className={clsx(
                    "text-xs transition-colors",
                    s.is_active
                      ? "text-accent hover:text-muted"
                      : "text-muted hover:text-accent",
                  )}
                >
                  {s.is_active ? "Active" : "Paused"}
                </button>
                <button
                  onClick={() => deleteSearchMutation.mutate(s.id)}
                  disabled={deleteSearchMutation.isPending}
                  className="text-muted hover:text-danger transition-colors"
                  aria-label="Delete search"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {!searches?.length && (
            <p className="text-xs text-muted">No saved searches yet.</p>
          )}
        </div>
      </div>

      {/* Scraper status */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Scraper status</h2>
        <div className="flex items-center gap-2">
          <span className={clsx("w-2 h-2 rounded-full", credColor)} />
          <span className="text-sm text-text">{credLabel}</span>
        </div>
        {credStatus?.last_error && !credStatus.active && (
          <p className="text-xs text-muted">
            Last error: {credStatus.last_error}
          </p>
        )}
      </div>
    </div>
  );
}
