import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { login } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    },
    onError: (err: Error) => {
      setError(err.message || "Invalid email or password");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-accent">JobScout</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your account</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            loginMutation.mutate();
          }}
          className="space-y-4 rounded-lg bg-surface border border-border p-6"
        >
          <div className="space-y-1">
            <Label htmlFor="email" className="text-text">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-background border-border text-text placeholder:text-muted"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password" className="text-text">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-background border-border text-text"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-accent text-background hover:bg-accent/90"
          >
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
