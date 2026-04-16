import { apiFetch } from "./client";
import type { JobHistoryItem, AppStatus } from "@/types";

export interface HistoryFilters {
  limit?: number;
  offset?: number;
  search?: string;
  status?: AppStatus;
  site?: string;
  min_score?: number;
  max_score?: number;
  recommend?: boolean;
  applied?: boolean;
  days?: number;
  profile_id?: number;
}

export interface HistoryStats {
  total: number;
  recs: number;
  high_score: number;
  avg_score: number;
  applied: number;
  phone_screen: number;
  interviewed: number;
  offer: number;
  rejected: number;
  response_rate: number;
  offer_rate: number;
}

export const listHistory = (filters: HistoryFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.site) params.set("site", filters.site);
  if (filters.min_score !== undefined) params.set("min_score", String(filters.min_score));
  if (filters.max_score !== undefined) params.set("max_score", String(filters.max_score));
  if (filters.recommend !== undefined) params.set("recommend", String(filters.recommend));
  if (filters.applied !== undefined) params.set("applied", String(filters.applied));
  if (filters.days !== undefined) params.set("days", String(filters.days));
  if (filters.profile_id !== undefined) params.set("profile_id", String(filters.profile_id));
  return apiFetch<JobHistoryItem[]>(`/api/v1/history?${params}`);
};

export const getStats = (profileId?: number) => {
  const params = profileId !== undefined ? `?profile_id=${profileId}` : "";
  return apiFetch<HistoryStats>(`/api/v1/history/stats${params}`);
};

export const patchStatus = (dbId: number, status: AppStatus) =>
  apiFetch<JobHistoryItem>(`/api/v1/job/${dbId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
