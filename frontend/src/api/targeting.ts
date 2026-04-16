import { apiFetch } from "./client";
import type {
  TargetKeywordItem,
  TargetSignalItem,
  CompaniesResponse,
} from "@/types";

export const getTargetKeywords = (profileId: number) =>
  apiFetch<TargetKeywordItem[]>(`/api/v1/profiles/${profileId}/target-keywords`);

export const addTargetKeyword = (profileId: number, keyword: string) =>
  apiFetch<{ keyword: string }>(`/api/v1/profiles/${profileId}/target-keywords`, {
    method: "POST",
    body: JSON.stringify({ keyword, source: "manual" }),
  });

export const deleteTargetKeyword = (profileId: number, keyword: string) =>
  apiFetch<void>(
    `/api/v1/profiles/${profileId}/target-keywords/${encodeURIComponent(keyword)}`,
    { method: "DELETE" },
  );

export const resetTargetKeywords = (profileId: number) =>
  apiFetch<{ reset: number }>(
    `/api/v1/profiles/${profileId}/target-keywords/reset`,
    { method: "POST" },
  );

export const getTargetSignals = (profileId: number) =>
  apiFetch<TargetSignalItem[]>(
    `/api/v1/keywords/target-signals/${profileId}`,
  );

export const getCompanies = (profileId?: number) => {
  const params = profileId ? `?profile_id=${profileId}` : "";
  return apiFetch<CompaniesResponse>(`/api/v1/companies${params}`);
};

export const addTargetCompany = (profileId: number, name: string) =>
  apiFetch<{ id: number; name: string }>("/api/v1/companies/target", {
    method: "POST",
    body: JSON.stringify({ profile_id: profileId, name }),
  });

export const deleteTargetCompany = (companyId: number) =>
  apiFetch<void>(`/api/v1/companies/target/${companyId}`, {
    method: "DELETE",
  });

export const addBlockCompany = (name: string) =>
  apiFetch<{ id: number; name: string }>("/api/v1/companies/block", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const deleteBlockCompany = (companyId: number) =>
  apiFetch<void>(`/api/v1/companies/block/${companyId}`, {
    method: "DELETE",
  });
