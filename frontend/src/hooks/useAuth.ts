import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/api/auth";
import type { User } from "@/types";

export function useAuth() {
  const { data: user, isLoading, isError } = useQuery<User>({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return { user, isLoading, isAuthenticated: !!user && !isError };
}
