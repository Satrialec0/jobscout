import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0f172a",
        surface: "#1e293b",
        border: "#334155",
        muted: "#475569",
        text: "#e2e8f0",
        accent: "#4ade80",
        "accent-dim": "#166534",
        warning: "#facc15",
        danger: "#f87171",
      },
    },
  },
  plugins: [],
} satisfies Config;
