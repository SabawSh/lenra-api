/**
 * Dashboard design tokens — aligned with globals.css `.dashboard-app` / `@theme`.
 * Prefer Tailwind utilities from `lib/layout/layout.ts` in components.
 */
export const dash = {
  bg: "#07111A",
  surface: "#0D1722",
  elevated: "#0E1724",
  card: "rgba(255,255,255,0.03)",
  primary: "#24D68F",
  blue: "#4DA3FF",
  purple: "#8B5CF6",
  gold: "#F5B942",
  text: "rgba(255,255,255,0.96)",
  textSecondary: "rgba(255,255,255,0.62)",
  textMuted: "rgba(255,255,255,0.38)",
  border: "rgba(255,255,255,0.06)",
} as const;

/** Shared elevated card — use `card.elevated` from layout.ts in new code */
export const DASH_CARD_ELEVATED =
  "ds-card-elevated rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-sm";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export const RARITY_STYLES: Record<
  AchievementRarity,
  { accent: string; border: string; label: string }
> = {
  common: {
    accent: dash.textMuted,
    border: "rgba(255,255,255,0.08)",
    label: "Common",
  },
  rare: {
    accent: dash.blue,
    border: "rgba(77,163,255,0.2)",
    label: "Rare",
  },
  epic: {
    accent: dash.purple,
    border: "rgba(139,92,246,0.25)",
    label: "Epic",
  },
  legendary: {
    accent: dash.gold,
    border: "rgba(245,185,66,0.28)",
    label: "Legendary",
  },
};
