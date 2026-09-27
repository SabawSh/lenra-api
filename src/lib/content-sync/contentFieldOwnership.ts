import type { PartDifficulty } from "@/types/video";
import type { PipelineClip, PipelineClipToken } from "./types";

/**
 * Fields the Content Pipeline owns on `parts`.
 * Runtime PK, episode_id, media URLs, created_at, learner FKs are excluded.
 */
export const PIPELINE_OWNED_PART_COLUMNS = [
  "canonical_key",
  "order",
  "text",
  "start_ms",
  "end_ms",
  "duration_ms",
  "speech_start_ms",
  "speech_end_ms",
  "speech_duration_ms",
  "tokens",
  "difficulty",
  "difficulty_score",
  "word_count",
  "speech_rate",
  "source_clip_start_ms",
  "source_clip_end_ms",
  "subtitles",
  "processing_status",
] as const;

/** Never overwritten by content sync. */
export const RUNTIME_OWNED_PART_COLUMNS = [
  "id",
  "episode_id",
  "video_url",
  "hls_manifest_url",
  "thumbnail_url",
  "created_at",
  "clip_group_id",
  "normalized_text",
  "sentences",
] as const;

export type PipelineOwnedPartPayload = {
  canonicalKey: string;
  order: number;
  text: string;
  playbackStartMs: number;
  playbackEndMs: number;
  playbackDurationMs: number;
  speechStartMs: number | null;
  speechEndMs: number | null;
  speechDurationMs: number | null;
  tokens: PipelineClipToken[];
  difficulty: PartDifficulty;
  difficultyScore: number | null;
  wordCount: number;
  speechRate: number | null;
  sourceClipStartMs: number | null;
  sourceClipEndMs: number | null;
  /** Stored for provenance; not used as learner identity. */
  subtitles: {
    sourceCues: string[] | null;
    sourceCueIndexes: number[] | null;
    pipelineClipId: string;
  } | null;
};

export function pipelineClipToOwnedPayload(
  clip: PipelineClip,
): PipelineOwnedPartPayload {
  return {
    canonicalKey: clip.canonicalKey,
    order: clip.order,
    text: clip.text,
    playbackStartMs: clip.startMs,
    playbackEndMs: clip.endMs,
    playbackDurationMs: clip.durationMs,
    speechStartMs: clip.speechStartMs,
    speechEndMs: clip.speechEndMs,
    speechDurationMs: clip.speechDurationMs,
    tokens: clip.tokens,
    difficulty: clip.level,
    difficultyScore: clip.difficultyScore,
    wordCount: clip.metrics?.wordCount ?? countWordTokens(clip.tokens),
    speechRate: clip.metrics?.speechRate ?? null,
    sourceClipStartMs: clip.encodeStartMs ?? clip.hls?.sourceStartMs ?? null,
    sourceClipEndMs: clip.encodeEndMs ?? clip.hls?.sourceEndMs ?? null,
    subtitles: {
      sourceCues: clip.sourceCues,
      sourceCueIndexes: clip.sourceCueIndexes,
      pipelineClipId: clip.pipelineId,
    },
  };
}

function countWordTokens(tokens: PipelineClipToken[]): number {
  return tokens.filter((t) => (t.type ?? "word") === "word").length;
}

export function stableTokensJson(tokens: PipelineClipToken[]): string {
  return JSON.stringify(tokens);
}
