import { apiFetch } from "./client";
import type { SignalItem } from "@/types";

export const getBlocklist = () =>
  apiFetch<{ terms: string[] }>("/api/v1/keywords/blocklist");

export const addBlocklistTerm = (term: string) =>
  apiFetch<{ term: string }>("/api/v1/keywords/blocklist", {
    method: "POST",
    body: JSON.stringify({ term }),
  });

export const deleteBlocklistTerm = (term: string) =>
  apiFetch<void>(`/api/v1/keywords/blocklist/${encodeURIComponent(term)}`, {
    method: "DELETE",
  });

export const getSignals = (profileId: number) =>
  apiFetch<SignalItem[]>(`/api/v1/keywords/signals/${profileId}`);
