import type { JsonValue } from "./json.js";
import type {
  EnglishLevel,
  PartDifficulty,
  ProcessingStatus,
  VideoType,
} from "./schema.js";

export type {
  EnglishLevel,
  PartDifficulty,
  ProcessingStatus,
  VideoType,
};

/**
 * A single token stored in `parts.tokens` (JSON column).
 * These are set during media processing and are the authoritative source
 * for puzzle generation — the frontend must NOT re-derive them.
 */
export interface PartToken {
  id: string;
  text: string;
  /** 1-based display order within the part. */
  order: number;
  /**
   * True when this token should appear as a draggable puzzle tile.
   * Punctuation and filler tokens have this set to false.
   */
  visibleInPuzzle: boolean;
  /** When true the tile is displayed but cannot be dragged (e.g. article, punctuation). */
  locked?: boolean;
  /** Pipeline token kind (e.g. `punctuation`, `word`). */
  type?: string;
  /** When `type` is `punctuation`: `period`, `ellipsis`, `exclamation`, `question`, etc. */
  punctuationType?: string;
  /**
   * Optional match hint from the pipeline (may keep apostrophes).
   * Runtime voice matching always canonicalizes via `normalizeText` (ASR uses "dont", not "don't").
   */
  normalized?: string;
  /** Dictionary sense UUID from the content pipeline (phrase-aware disambiguation). */
  senseId?: string;
  /** Dictionary entry UUID when the pipeline has resolved a word or phrase entry. */
  dictionaryEntryId?: string;
  /** Canonical phrase pattern when this token belongs to a multi-word expression. */
  matchedPhrase?: string;
}

/**
 * A sentence boundary stored in `parts.sentences` (JSON column).
 * Render sentence blocks from this — never split by punctuation at runtime.
 */
export interface PartSentence {
  id: string;
  text: string;
  /** 1-based order within the part. */
  order: number;
  startMs?: number;
  endMs?: number;
}

export interface Video {
  id: string;
  name: string;
  /** Stable slug for CDN matching (e.g. friends, the_pursuit_of_happiness). */
  tag: string;
  type: VideoType;
  seasons?: Season[];
  description: string | null;
  releaseAt: Date;
  createdAt: Date;
  coverUrl: string | null;
  parts?: Part[];
  /** True when the user has started this content — computed at query time, not stored. */
  watched?: boolean;
  /** Completed-part percentage (0–100) for the resume scope — computed at query time. */
  progressPct?: number;
  /** Total learning parts for movies — computed at query time for library views. */
  partsCount?: number;
  /** True when content is behind a paywall — reserved for future use. */
  premium?: boolean;
  genres: string[];
  levels: string[];
  /**
   * Content difficulty distribution from `parts.difficulty` (easy/medium/hard→advanced).
   * Library-only metadata — unrelated to CEFR `levels` or skill-engine merge.
   */
  difficultyMix?: {
    easy: number;
    medium: number;
    advanced: number;
    total: number;
  };
  isNew: boolean;
  imdbRating: number | null;
  isLiked: boolean;
  durationMs: number | null;
  sourceVideoUrl: string | null;
  sourceSubtitleUrl: string | null;
  defaultAudioLanguage: string;
  processingStatus: ProcessingStatus;
}

export interface Season {
  id: string;
  videoId: string;
  seasonNum: number;
  coverUrl: string | null;
  episodes?: Episode[];
  _count?: { episodes: number };
}

export interface Episode {
  id: string;
  seasonId: string;
  episodeNum: number;
  title: string;
  description: string | null;
  coverUrl: string | null;
  releaseAt: Date;
  durationMs: number | null;
  sourceVideoUrl: string | null;
  sourceSubtitleUrl: string | null;
  processingStatus: ProcessingStatus;
  createdAt: Date;
  parts?: Part[];
}

export interface Part {
  id: string;
  episodeId: string;
  order: number;
  /**
   * Content Pipeline stable content identity (`parts.canonical_key`).
   * Nullable until sync; not unique — identical text may share one key across
   * multiple runtime parts. Distinct from `id` (learner/FK identity).
   */
  canonicalKey: string | null;
  /** Speech window — subtitle/dialog timing for learning engine and analytics. */
  speechStartMs: number | null;
  speechEndMs: number | null;
  speechDurationMs: number | null;
  /** Playback window — encoded clip bounds (`parts.start_ms` / `end_ms` / `duration_ms`). */
  playbackStartMs: number | null;
  playbackEndMs: number | null;
  playbackDurationMs: number | null;
  text: string;
  normalizedText: string | null;
  /**
   * Structured sentence boundaries from the DB.
   * Use these directly for sentence rendering — never split text at runtime.
   */
  sentences: PartSentence[] | null;
  /**
   * Structured tokens from the DB.
   * Use these directly for puzzle generation — never re-tokenize text at runtime.
   */
  tokens: PartToken[] | null;
  subtitles: JsonValue | null;
  wordCount: number;
  speechRate: number | null;
  difficulty: PartDifficulty;
  difficultyScore: number | null;
  clipGroupId: string | null;
  videoUrl: string | null;
  hlsManifestUrl: string | null;
  thumbnailUrl: string | null;
  sourceClipStartMs: number | null;
  sourceClipEndMs: number | null;
  processingStatus: ProcessingStatus;
  /**
   * Soft-retire timestamp (`parts.retired_at`). Null = active in learner playlists.
   * Content sync retires removed clips without hard DELETE.
   */
  retiredAt: Date | null;
  createdAt: Date;
  translations?: CaptionTranslation[];
}

export interface CaptionTranslation {
  id: number;
  partId: string;
  language: string;
  text: string;
  translatedSentences: JsonValue | null;
  provider: string | null;
  providerModel: string | null;
  createdAt: Date;
}
