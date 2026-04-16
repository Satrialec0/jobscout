import { clsx } from "clsx";
import type { AppStatus } from "@/types";

const STATUS_CYCLE: AppStatus[] = [
  "applied",
  "phone_screen",
  "interviewed",
  "offer",
  "rejected",
  null,
];

const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  phone_screen: "Phone Screen",
  interviewed: "Interviewed",
  offer: "Offer",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  applied: "bg-blue-900 text-blue-300",
  phone_screen: "bg-purple-900 text-purple-300",
  interviewed: "bg-yellow-900 text-yellow-300",
  offer: "bg-accent-dim text-accent",
  rejected: "bg-red-900 text-red-300",
};

interface StatusPillProps {
  status: AppStatus;
  onClick?: (next: AppStatus) => void;
  disabled?: boolean;
}

export function StatusPill({ status, onClick, disabled }: StatusPillProps) {
  const handleClick = () => {
    if (!onClick || disabled) return;
    const currentIdx = STATUS_CYCLE.indexOf(status);
    const nextIdx = (currentIdx + 1) % STATUS_CYCLE.length;
    onClick(STATUS_CYCLE[nextIdx]);
  };

  if (!status) {
    return (
      <button
        onClick={handleClick}
        disabled={disabled}
        className="text-xs text-muted hover:text-text transition-colors disabled:cursor-not-allowed"
      >
        + Track
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={clsx(
        "px-2 py-0.5 rounded-full text-xs font-medium transition-opacity",
        STATUS_COLORS[status] ?? "bg-border text-muted",
        onClick && !disabled ? "hover:opacity-80 cursor-pointer" : "cursor-default",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </button>
  );
}
