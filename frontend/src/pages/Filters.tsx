import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBlocklistTerm,
  deleteBlocklistTerm,
  getBlocklist,
} from "@/api/keywords";
import { addBlockCompany, deleteBlockCompany, getCompanies } from "@/api/targeting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";

export function Filters() {
  const queryClient = useQueryClient();
  const [newTerm, setNewTerm] = useState("");
  const [newCompany, setNewCompany] = useState("");

  const { data: blocklist } = useQuery({
    queryKey: ["blocklist"],
    queryFn: getBlocklist,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: () => getCompanies(),
  });

  const addTermMutation = useMutation({
    mutationFn: () => addBlocklistTerm(newTerm.trim()),
    onSuccess: () => {
      setNewTerm("");
      queryClient.invalidateQueries({ queryKey: ["blocklist"] });
    },
  });

  const deleteTermMutation = useMutation({
    mutationFn: deleteBlocklistTerm,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["blocklist"] }),
  });

  const addCompanyMutation = useMutation({
    mutationFn: () => addBlockCompany(newCompany.trim()),
    onSuccess: () => {
      setNewCompany("");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: deleteBlockCompany,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["companies"] }),
  });

  const sectionClass = "rounded-lg bg-surface border border-border p-5 space-y-4";
  const headingClass = "text-sm font-semibold text-text";
  const pillClass =
    "flex items-center gap-2 bg-border rounded px-2.5 py-1 text-sm text-text";

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-text">Avoiding</h1>

      {/* Manual keyword blocklist */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Keyword blocklist</h2>
        <p className="text-xs text-muted">
          Jobs matching these terms will be dimmed on all job sites.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newTerm.trim()) addTermMutation.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="e.g. Java, manager, on-site"
            className="bg-background border-border text-text flex-1"
          />
          <Button
            type="submit"
            disabled={!newTerm.trim() || addTermMutation.isPending}
            className="bg-accent text-background hover:bg-accent/90"
          >
            Add
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {blocklist?.terms.map((term) => (
            <div key={term} className={pillClass}>
              {term}
              <button
                onClick={() => deleteTermMutation.mutate(term)}
                className="text-muted hover:text-danger transition-colors"
                aria-label={`Remove ${term}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!blocklist?.terms.length && (
            <p className="text-xs text-muted">No terms added yet.</p>
          )}
        </div>
      </div>

      {/* Blocked companies */}
      <div className={sectionClass}>
        <h2 className={headingClass}>Blocked companies</h2>
        <p className="text-xs text-muted">
          Jobs from these companies will always be dimmed.
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
          {companies?.blocks.map((c) => (
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
          {!companies?.blocks.length && (
            <p className="text-xs text-muted">No companies blocked yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
