import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { activateProfile, listProfiles, updateProfile, parseResume } from "@/api/profiles";
import { deleteSearch, listSearches, patchSearch } from "@/api/searches";
import { getCredentialStatus } from "@/api/credentials";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { clsx } from "clsx";
import { useState, useRef } from "react";
import type { Profile } from "@/types";

function ProfileEditPanel({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();

  const [resumeText, setResumeText] = useState(profile.resume_text ?? "");
  const [instructions, setInstructions] = useState(profile.instructions);
  const [appAssistInstructions, setAppAssistInstructions] = useState(
    profile.app_assist_instructions ?? ""
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateProfile>[1]) =>
      updateProfile(profile.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const parseMutation = useMutation({
    mutationFn: parseResume,
    onSuccess: (text) => {
      setResumeText(text);
      setUploadError(null);
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadLabel(file.name);
    setUploadError(null);
    parseMutation.mutate(file);
  };

  const handleSave = () => {
    saveMutation.mutate({
      resume_text: resumeText || undefined,
      instructions: instructions || undefined,
      app_assist_instructions: appAssistInstructions || undefined,
    });
  };

  const labelClass = "block text-xs font-medium text-muted mb-1";
  const textareaClass =
    "w-full rounded bg-black border border-border text-sm text-text p-2 resize-y focus:outline-none focus:border-accent";

  return (
    <div className="pt-3 space-y-4">
      {/* Resume */}
      <div>
        <label className={labelClass}>Resume</label>
        <textarea
          rows={6}
          className={textareaClass}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="Paste resume text, or upload a PDF/DOCX below"
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={parseMutation.isPending}
            className="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
          >
            <Upload size={12} />
            {parseMutation.isPending ? "Parsing…" : "Upload PDF or DOCX"}
          </button>
          {uploadLabel && !parseMutation.isPending && (
            <span className="text-xs text-muted">{uploadLabel}</span>
          )}
          {uploadError && (
            <span className="text-xs text-danger">{uploadError}</span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Job analysis instructions */}
      <div>
        <label className={labelClass}>Job analysis instructions</label>
        <textarea
          rows={4}
          className={textareaClass}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      {/* App assist instructions */}
      <div>
        <label className={labelClass}>
          Application assistant instructions
          <span className="font-normal ml-1 text-muted">
            — used when generating answers to application questions
          </span>
        </label>
        <textarea
          rows={3}
          className={textareaClass}
          value={appAssistInstructions}
          onChange={(e) => setAppAssistInstructions(e.target.value)}
          placeholder="e.g. Keep answers under 3 sentences. Focus on measurable outcomes."
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </button>
        {saveMutation.isSuccess && (
          <span className="text-xs text-accent">Saved</span>
        )}
        {saveMutation.isError && (
          <span className="text-xs text-danger">
            {(saveMutation.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}

function ProfileRow({
  profile,
  onActivate,
  isActivating,
}: {
  profile: Profile;
  onActivate: () => void;
  isActivating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center justify-between py-2">
        <button
          className="flex items-center gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="text-sm text-text">{profile.name}</span>
          {profile.is_active && (
            <Badge className="bg-accent-dim text-accent text-xs">Active</Badge>
          )}
          {expanded ? (
            <ChevronUp size={14} className="text-muted" />
          ) : (
            <ChevronDown size={14} className="text-muted" />
          )}
        </button>
        {!profile.is_active && (
          <button
            onClick={onActivate}
            disabled={isActivating}
            className="text-xs text-accent hover:underline disabled:opacity-50"
          >
            Activate
          </button>
        )}
      </div>
      {expanded && <ProfileEditPanel profile={profile} />}
    </div>
  );
}

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

      {/* Profiles */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Profiles</h2>
        <div className="space-y-0">
          {profiles?.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onActivate={() => activateMutation.mutate(profile.id)}
              isActivating={activateMutation.isPending}
            />
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
