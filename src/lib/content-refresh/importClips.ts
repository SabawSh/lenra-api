import { randomUUID } from "crypto";
import type { ResultSetHeader } from "mysql2/promise";
import type { PipelineClip } from "../content-sync/types";
import { pipelineClipToOwnedPayload } from "../content-sync/contentFieldOwnership";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { DbExecutor } from "./resetEpisodeParts";

/**
 * Insert all clips for a clean episode rebuild.
 *
 * parts.id is always a new Lenra UUID. Pipeline identity is canonical_key
 * (plus presentation order for duplicate keys). Pipeline clip UUIDs are stored
 * only in subtitles provenance JSON — never used as the part PK.
 */
export async function insertPartsFromClips(
  episodeId: string,
  clips: PipelineClip[],
  db: DbExecutor = getContentSyncPool(),
): Promise<number> {
  for (const clip of clips) {
    const payload = pipelineClipToOwnedPayload(clip);
    const partId = randomUUID();
    const tokensJson = JSON.stringify(payload.tokens ?? []);
    const subtitlesJson = payload.subtitles
      ? JSON.stringify(payload.subtitles)
      : null;

    await db.execute<ResultSetHeader>(
      `
      INSERT INTO parts (
        id, episode_id, \`order\`, canonical_key,
        start_ms, end_ms, duration_ms,
        speech_start_ms, speech_end_ms, speech_duration_ms,
        text, tokens, subtitles,
        word_count, speech_rate,
        difficulty, difficulty_score,
        source_clip_start_ms, source_clip_end_ms,
        processing_status, retired_at, created_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, CAST(? AS JSON), CAST(? AS JSON),
        ?, ?,
        ?, ?,
        ?, ?,
        'ready', NULL, NOW(3)
      )
      `,
      [
        partId,
        episodeId,
        payload.order,
        payload.canonicalKey,
        payload.playbackStartMs,
        payload.playbackEndMs,
        payload.playbackDurationMs,
        payload.speechStartMs,
        payload.speechEndMs,
        payload.speechDurationMs,
        payload.text,
        tokensJson,
        subtitlesJson,
        payload.wordCount,
        payload.speechRate,
        payload.difficulty,
        payload.difficultyScore,
        payload.sourceClipStartMs,
        payload.sourceClipEndMs,
      ],
    );
  }

  return clips.length;
}
