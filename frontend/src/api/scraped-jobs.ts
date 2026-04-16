import { apiFetch } from "./client";
import type { ScrapedJob, JobHistoryItem } from "@/types";

export const listScrapedJobs = () =>
  apiFetch<ScrapedJob[]>("/api/v1/scraper/jobs");

export const dismissJob = (id: number) =>
  apiFetch<void>(`/api/v1/scraper/jobs/${id}/dismiss`, { method: "POST" });

export const analyzeJob = (id: number) =>
  apiFetch<JobHistoryItem>(`/api/v1/scraper/jobs/${id}/analyze`, {
    method: "POST",
  });
