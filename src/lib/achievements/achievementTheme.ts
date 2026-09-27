import type { AchievementRarity } from "@/lib/dashboard/tokens";

/** Cinematic, muted rarity palette for achievements UI only. */
export const ACHIEVEMENT_RARITY: Record<
  AchievementRarity,
  {
    accent: string;
    border: string;
    soft: string;
    glow: string;
    /** Solid colors for progress bar fill (rgba accents cannot use hex-style gradients). */
    progressFrom: string;
    progressTo: string;
  }
> = {
  common: {
    accent: "rgba(148, 163, 184, 0.85)",
    border: "rgba(148, 163, 184, 0.14)",
    soft: "rgba(148, 163, 184, 0.06)",
    glow: "rgba(148, 163, 184, 0.08)",
    progressFrom: "#8b9cb0",
    progressTo: "#a8b8cc",
  },
  rare: {
    accent: "rgba(125, 168, 220, 0.92)",
    border: "rgba(77, 163, 255, 0.18)",
    soft: "rgba(77, 163, 255, 0.07)",
    glow: "rgba(77, 163, 255, 0.1)",
    progressFrom: "#3d7ec4",
    progressTo: "#5a9ee8",
  },
  epic: {
    accent: "rgba(167, 139, 250, 0.9)",
    border: "rgba(139, 92, 246, 0.2)",
    soft: "rgba(139, 92, 246, 0.08)",
    glow: "rgba(139, 92, 246, 0.12)",
    progressFrom: "#7c5ce0",
    progressTo: "#9b7df0",
  },
  legendary: {
    accent: "rgba(214, 180, 106, 0.95)",
    border: "rgba(245, 185, 66, 0.22)",
    soft: "rgba(245, 185, 66, 0.09)",
    glow: "rgba(245, 185, 66, 0.14)",
    progressFrom: "#c49a3a",
    progressTo: "#e0b85a",
  },
};

const RARITY_RANK: Record<AchievementRarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export function rarityRank(rarity: AchievementRarity): number {
  return RARITY_RANK[rarity];
}
