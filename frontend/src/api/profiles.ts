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
