/**
 * Movie-library content difficulty mix (Easy / Medium / Advanced).
 *
 * Aggregates persisted `parts.difficulty` enum values only.
 * Does NOT use difficultyScore or CEFR `videos.levels`.
 * Does NOT affect learning-unit merge.
 */

import type { EnglishLevel, PartDifficulty } from "@/types/schema";

export type ContentDifficultyBucket = "easy" | "medium" | "advanced";

export type VideoDifficultyMix = {
  easy: number;
  medium: number;
  advanced: number;
  total: number;
};

export type ContentDifficultyFilter = "All" | ContentDifficultyBucket;

export const CONTENT_DIFFICULTY_FILTERS: readonly ContentDifficultyFilter[] = [
  "All",
  "easy",
  "medium",
  "advanced",
] as const;

export function emptyDifficultyMix(): VideoDifficultyMix {
  return { easy: 0, medium: 0, advanced: 0, total: 0 };
}

/** Map persisted part difficulty enum → UI bucket (`hard` → Advanced). */
export function mapPartDifficultyToBucket(
  difficulty: PartDifficulty | string | null | undefined,
): ContentDifficultyBucket | null {
  const raw = String(difficulty ?? "")
    .trim()
    .toLowerCase();
  if (raw === "easy") return "easy";
  if (raw === "medium") return "medium";
  if (raw === "hard") return "advanced";
  return null;
}

export function buildDifficultyMixFromCounts(args: {
  easy?: number;
  medium?: number;
  hard?: number;
  advanced?: number;
}): VideoDifficultyMix {
  const easy = Math.max(0, Math.floor(Number(args.easy) || 0));
  const medium = Math.max(0, Math.floor(Number(args.medium) || 0));
  const advanced = Math.max(
    0,
    Math.floor(Number(args.advanced ?? args.hard) || 0),
  );
  return {
    easy,
    medium,
    advanced,
    total: easy + medium + advanced,
  };
}

export type DifficultyMixPercents = {
  easy: number;
  medium: number;
  advanced: number;
};

/** Integer percents from counts. Returns null when total is 0 (do not render). */
export function difficultyMixPercents(
  mix: VideoDifficultyMix | null | undefined,
): DifficultyMixPercents | null {
  if (!mix || mix.total <= 0) return null;
  return {
    easy: Math.round((mix.easy / mix.total) * 100),
    medium: Math.round((mix.medium / mix.total) * 100),
    advanced: Math.round((mix.advanced / mix.total) * 100),
  };
}

/**
 * Filter: movie matches if it contains ≥1 clip in the selected bucket.
 * "All" matches everything (including videos with no difficulty data).
 */
export function videoMatchesContentDifficultyFilter(
  mix: VideoDifficultyMix | null | undefined,
  filter: ContentDifficultyFilter,
): boolean {
  if (filter === "All") return true;
  if (!mix || mix.total <= 0) return false;
  return mix[filter] > 0;
}

/** Parse learn / sections `contentDifficulty` query (invalid → All). */
export function parseContentDifficultyFilter(
  raw: string | null | undefined,
): ContentDifficultyFilter {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "easy" || value === "medium" || value === "advanced") {
    return value;
  }
  return "All";
}

/** Single clip matches the content-difficulty filter. */
export function partMatchesContentDifficultyFilter(
  difficulty: PartDifficulty | string | null | undefined,
  filter: ContentDifficultyFilter,
): boolean {
  if (filter === "All") return true;
  return mapPartDifficultyToBucket(difficulty) === filter;
}

/**
 * Soft recommendation from onboarding English level → content bucket.
 * Returns null when level is missing or the movie has no clips in that bucket.
 */
export function recommendContentDifficultyFromEnglishLevel(
  level: EnglishLevel | null | undefined,
  mix: VideoDifficultyMix | null | undefined,
): ContentDifficultyBucket | null {
  if (!level || !mix || mix.total <= 0) return null;

  let bucket: ContentDifficultyBucket | null = null;
  if (level === "beginner" || level === "elementary") bucket = "easy";
  else if (level === "intermediate" || level === "upperIntermediate") {
    bucket = "medium";
  } else if (level === "advanced") bucket = "advanced";

  if (!bucket || mix[bucket] <= 0) return null;
  return bucket;
}

/**
 * Which section indices (order-based windows) contain ≥1 clip in `filter`.
 * Used for movie-sections map filtering — not adaptive regrouping.
 */
export function sectionIndicesMatchingContentDifficulty(
  parts: ReadonlyArray<{ order: number; difficulty: PartDifficulty | string }>,
  filter: ContentDifficultyFilter,
  sectionIndexFromOrder: (order: number) => number,
): Set<number> {
  if (filter === "All") {
    const all = new Set<number>();
    for (const part of parts) {
      if (part.order >= 1) all.add(sectionIndexFromOrder(part.order));
    }
    return all;
  }

  const matching = new Set<number>();
  for (const part of parts) {
    if (!partMatchesContentDifficultyFilter(part.difficulty, filter)) continue;
    if (part.order >= 1) matching.add(sectionIndexFromOrder(part.order));
  }
  return matching;
}

/** Append or clear `contentDifficulty` on a learn/section href. */
export function withContentDifficultyQuery(
  href: string | null,
  filter: ContentDifficultyFilter,
): string | null {
  if (!href) return null;
  const qIndex = href.indexOf("?");
  const path = qIndex >= 0 ? href.slice(0, qIndex) : href;
  const search = qIndex >= 0 ? href.slice(qIndex + 1) : "";
  const params = new URLSearchParams(search);
  if (filter === "All") {
    params.delete("contentDifficulty");
  } else {
    params.set("contentDifficulty", filter);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
