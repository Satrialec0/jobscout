import { apiFetch } from "./client";
import type { Profile } from "@/types";

export const listProfiles = () =>
  apiFetch<Profile[]>("/api/v1/profiles");

export const activateProfile = (profileId: number) =>
  apiFetch<Profile>(`/api/v1/profiles/${profileId}/activate`, {
    method: "POST",
  });

interface ActiveProfile {
  id: number;
  name: string;
}

export const getActiveProfile = () =>
  apiFetch<ActiveProfile | null>("/api/v1/profiles/active");

interface ProfileUpdateBody {
  name?: string;
  resume_text?: string;
  instructions?: string;
  app_assist_instructions?: string;
}

export const updateProfile = (profileId: number, body: ProfileUpdateBody) =>
  apiFetch<Profile>(`/api/v1/profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const parseResume = async (file: File): Promise<string> => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/v1/profiles/parse-resume", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.text as string;
};
