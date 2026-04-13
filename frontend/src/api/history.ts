import { apiFetch } from "./client";
import type { JobHistoryItem, AppStatus } from "@/types";

export interface HistoryFilters {
  limit?: number;
  offset?: number;
  status?: AppStatus;
  site?: string;
  min_score?: number;
  max_score?: number;
}

export const listHistory = (filters: HistoryFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.status) params.set("status", filters.status);
  if (filters.site) params.set("site", filters.site);
  if (filters.min_score !== undefined)
    params.set("min_score", String(filters.min_score));
  if (filters.max_score !== undefined)
    params.set("max_score", String(filters.max_score));
  return apiFetch<JobHistoryItem[]>(`/api/v1/history?${params}`);
};

export const patchStatus = (dbId: number, status: AppStatus) =>
  apiFetch<JobHistoryItem>(`/api/v1/job/${dbId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
