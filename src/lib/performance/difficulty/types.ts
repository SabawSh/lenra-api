import type { PartDifficulty } from "@/types/video";

/** Token or puzzle-chunk surface used to infer linguistic weight. */
export type TokenDifficultyInput = {
  text: string;
  locked?: boolean;
  visibleInPuzzle?: boolean;
  type?: string;
  /** Normalized sub-words when scoring a puzzle chunk. */
  tokenCount?: number;
  clipDifficulty?: PartDifficulty;
};

export type PerformanceChunkRef = {
  id: string;
  text: string;
  tokens: string[];
  locked?: boolean;
};

/** Optional clip context — backward-compatible when omitted. */
export type PerformanceChallenge = {
  clipDifficulty?: PartDifficulty;
  difficultyScore?: number | null;
  speechRate?: number | null;
  /** Puzzle chunks in answer order (same as `originalParts`). */
  chunks?: PerformanceChunkRef[];
};
