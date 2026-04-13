import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logout } from "@/api/auth";
import { useAuth } from "@/hooks/useAuth";
import {
  Briefcase,
  Clock,
  Filter,
  LogOut,
  Settings,
  Target,
} from "lucide-react";
import { clsx } from "clsx";

const navItems = [
  { to: "/", label: "While You Were Gone", icon: Clock, end: true },
  { to: "/history", label: "Job History", icon: Briefcase },
  { to: "/filters", label: "Avoiding", icon: Filter },
  { to: "/targeting", label: "Targeting", icon: Target },
  { to: "/account", label: "Account", icon: Settings },
];

export function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login");
    },
  });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-surface border-r border-border flex flex-col">
        <div className="px-4 py-5 border-b border-border">
          <span className="text-accent font-semibold text-lg">JobScout</span>
          {user && (
            <p className="text-muted text-xs mt-0.5 truncate">{user.email}</p>
          )}
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-accent-dim text-accent font-medium"
                    : "text-muted hover:text-text hover:bg-border",
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 py-3 border-t border-border">
          <button
            onClick={() => logoutMutation.mutate()}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted hover:text-danger hover:bg-border w-full transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
