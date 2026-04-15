import { apiFetch } from "./client";
import type { SavedSearch } from "@/types";

export const listSearches = () =>
  apiFetch<SavedSearch[]>("/api/v1/scraper/searches");

export const patchSearch = (
  id: number,
  updates: { name?: string; is_active?: boolean },
) =>
  apiFetch<SavedSearch>(`/api/v1/scraper/searches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });

export const deleteSearch = (id: number) =>
  apiFetch<void>(`/api/v1/scraper/searches/${id}`, { method: "DELETE" });
