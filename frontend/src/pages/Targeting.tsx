import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getActiveProfile } from "@/api/profiles";
import {
  addTargetCompany,
  addTargetKeyword,
  deleteTargetCompany,
  deleteTargetKeyword,
  getCompanies,
  getTargetKeywords,
  getTargetSignals,
  resetTargetKeywords,
} from "@/api/targeting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";

export function Targeting() {
  const queryClient = useQueryClient();
  const [newKeyword, setNewKeyword] = useState("");
  const [newCompany, setNewCompany] = useState("");

  const { data: activeProfile } = useQuery({
    queryKey: ["active-profile"],
    queryFn: getActiveProfile,
  });

  const profileId = activeProfile?.id;

  const { data: targetKeywords } = useQuery({
    queryKey: ["target-keywords", profileId],
    queryFn: () => getTargetKeywords(profileId!),
    enabled: !!profileId,
  });

  const { data: targetSignals } = useQuery({
    queryKey: ["target-signals", profileId],
    queryFn: () => getTargetSignals(profileId!),
    enabled: !!profileId,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies", profileId],
    queryFn: () => getCompanies(profileId),
    enabled: !!profileId,
  });

  const addKwMutation = useMutation({
    mutationFn: () => addTargetKeyword(profileId!, newKeyword.trim()),
    onSuccess: () => {
      setNewKeyword("");
      queryClient.invalidateQueries({ queryKey: ["target-keywords", profileId] });
    },
  });

  const deleteKwMutation = useMutation({
    mutationFn: (kw: string) => deleteTargetKeyword(profileId!, kw),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["target-keywords", profileId] }),
  });

  const resetKwMutation = useMutation({
    mutationFn: () => resetTargetKeywords(profileId!),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["target-keywords", profileId] }),
  });

  const addCompanyMutation = useMutation({
    mutationFn: () => addTargetCompany(profileId!, newCompany.trim()),
    onSuccess: () => {
      setNewCompany("");
      queryClient.invalidateQueries({ queryKey: ["companies", profileId] });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: (id: number) => deleteTargetCompany(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["companies", profileId] }),
  });

  const sectionClass = "rounded-lg bg-surface border border-border p-5 space-y-4";
  const headingClass = "text-sm font-semibold text-text";
  const pillClass =
    "flex items-center gap-2 bg-border rounded px-2.5 py-1 text-sm text-text";

  if (!activeProfile) {
    return (
      <div className="p-8 text-muted text-sm">
        No active profile. Create one in Account settings.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-text">Targeting</h1>
      <p className="text-sm text-muted">Profile: {activeProfile.name}</p>

      {/* Target keywords */}
      <div className={sectionClass}>
        <div className="flex items-center justify-between">
          <h2 className={headingClass}>Target keywords</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resetKwMutation.mutate()}
            disabled={resetKwMutation.isPending}
            className="border-border text-muted text-xs hover:text-text"
          >
            {resetKwMutation.isPending ? "Resetting…" : "Reset from resume"}
          </Button>
        </div>
        <p className="text-xs text-muted">
          Jobs matching these keywords get highlighted. Resume keywords are
          auto-extracted; add manual ones below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newKeyword.trim()) addKwMutation.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="e.g. TypeScript, distributed systems"
            className="bg-background border-border text-text flex-1"
          />
          <Button
            type="submit"
            disabled={!newKeyword.trim() || addKwMutation.isPending}
            className="bg-accent text-background hover:bg-accent/90"
          >
            Add
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {targetKeywords?.map((kw) => (
            <div key={kw.id} className={pillClass}>
              <span>{kw.keyword}</span>
              <span className="text-xs text-muted">({kw.source})</span>
              <button
                onClick={() => deleteKwMutation.mutate(kw.keyword)}
                className="text-muted hover:text-danger transition-colors"
                aria-label={`Remove ${kw.keyword}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!targetKeywords?.length && (
            <p className="text-xs text-muted">No keywords yet.</p>
          )}
        </div>
      </div>

      {/* Learned target signals */}
      {targetSignals && targetSignals.length > 0 && (
        <div className={sectionClass}>
          <h2 className={headingClass}>Learned target signals</h2>
          <p className="text-xs text-muted">
            Auto-detected from jobs you engaged with. Read-only.
          </p>
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-background border-b border-border">
                <tr>
                  {["Keyword", "Target hits", "Show hits"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs text-muted font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetSignals.map((s) => (
                  <tr key={s.ngram} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-text">{s.ngram}</td>
                    <td className="px-3 py-2 text-muted">{s.target_count}</td>
                    <td className="px-3 py-2 text-muted">{s.show_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Target companies */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Target companies</h2>
        <p className="text-xs text-muted">
          Jobs from these companies are always surfaced. Auto-populated from
          high-score analyses; add manually below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newCompany.trim()) addCompanyMutation.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
            placeholder="Company name"
            className="bg-background border-border text-text flex-1"
          />
          <Button
            type="submit"
            disabled={!newCompany.trim() || addCompanyMutation.isPending}
            className="bg-accent text-background hover:bg-accent/90"
          >
            Add
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {companies?.targets.map((c) => (
            <div key={c.id} className={pillClass}>
              {c.name}
              <button
                onClick={() => deleteCompanyMutation.mutate(c.id)}
                className="text-muted hover:text-danger transition-colors"
                aria-label={`Remove ${c.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!companies?.targets.length && (
            <p className="text-xs text-muted">No target companies yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
