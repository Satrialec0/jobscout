import { apiFetch } from "./client";
import type { User } from "@/types";

export const getMe = () => apiFetch<User>("/api/v1/auth/me");

export const login = (email: string, password: string) =>
  apiFetch<{ ok: boolean }>("/api/v1/auth/web-login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logout = () =>
  apiFetch<{ ok: boolean }>("/api/v1/auth/web-logout", { method: "POST" });
