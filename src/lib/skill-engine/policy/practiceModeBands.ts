import { clampScore } from "@/lib/skill-engine/policy/adaptiveSelectionConfig";

/** @deprecated Enum difficulty fallbacks removed — use `difficultyScore` (0–100). */
export const DIFFICULTY_FALLBACK = {
  easy: 25,
  medium: 50,
  hard: 75,
} as const;

/** @deprecated Practice modes removed — see `DEFAULT_ADAPTIVE_SELECTION_CONFIG`. */
export const MODE_BANDS = {
  easy: { min: -20, max: 5, target: -8 },
  medium: { min: -5, max: 15, target: 5 },
  hard: { min: 5, max: 25, target: 15 },
} as const;

/** @deprecated Use `clampScore` from adaptiveSelectionConfig. */
export function clamp(value: number, min: number, max: number): number {
  return clampScore(value, min, max);
}
