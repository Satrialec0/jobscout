import { apiFetch } from "./client";
import type { CredentialStatus } from "@/types";

export const getCredentialStatus = () =>
  apiFetch<CredentialStatus>("/api/v1/scraper/credentials/status");
