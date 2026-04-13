import { apiFetch } from "./client";
import type { Profile } from "@/types";

export const listProfiles = () =>
  apiFetch<Profile[]>("/api/v1/profiles");

export const activateProfile = (profileId: number) =>
  apiFetch<Profile>(`/api/v1/profiles/${profileId}/activate`, {
    method: "POST",
  });
