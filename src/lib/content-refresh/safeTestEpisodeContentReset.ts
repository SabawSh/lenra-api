import type { RowDataPacket } from "mysql2/promise";

import { getContentSyncPool } from "../content-sync/syncDb";
import {
  assertEpisodeExists,
  countEpisodeResetImpact,
  resetEpisodeParts,
  type DbExecutor,
  type EpisodeResetImpact,
} from "./resetEpisodeParts";

export type EpisodeContentResetContext = {
  episodeId: string;
  episodeTitle: string | null;
  videoId: string | null;
  videoName: string | null;
  activeParts: number;
  retiredParts: number;
};

export type EpisodeContentResetCounts = EpisodeResetImpact & {
  willDeleteUserMaterializedSections: number;
};

export type EpisodeContentResetPreview = {
  dryRun: true;
  context: EpisodeContentResetContext;
  counts: EpisodeContentResetCounts;
  learnerProgressBlockers: string[];
  allowed: boolean;
  /** Content-sync plan state is in-memory only — no DB metadata table. */
  notes: string[];
};

export type EpisodeContentResetApplyResult = {
  dryRun: false;
  context: EpisodeContentResetContext;
  countsBefore: EpisodeContentResetCounts;
  partsDeleted: number;
  materializedSectionsDeleted: number;
};

export type EpisodeContentResetOptions = {
  /** Dev / staging only — delete learner progress rows before wiping parts. */
  confirmDiscardLearnerProgress?: boolean;
};

export class EpisodeContentResetBlockedError extends Error {
  readonly code = "LEARNER_PROGRESS_EXISTS" as const;
  readonly preview: EpisodeContentResetPreview;

  constructor(preview: EpisodeContentResetPreview) {
    super(
      `Reset blocked: learner progress exists for episode ${preview.context.episodeId}`,
    );
    this.name = "EpisodeContentResetBlockedError";
    this.preview = preview;
  }
}

async function tableExists(db: DbExecutor, table: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT 1 AS ok
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    LIMIT 1
    `,
    [table],
  );
  return rows.length > 0;
}

async function countMaterializedSectionsForEpisode(
  episodeId: string,
  db: DbExecutor,
): Promise<number> {
  if (!(await tableExists(db, "user_materialized_sections"))) return 0;

  const [videoRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(s.video_id AS CHAR) AS videoId
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE e.id = ?
    LIMIT 1
    `,
    [episodeId],
  );
  const videoId = videoRows[0]?.videoId ? String(videoRows[0].videoId) : null;

  if (videoId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM user_materialized_sections
      WHERE episode_id = ?
         OR (
           video_id = ?
           AND (episode_id IS NULL OR episode_id = ?)
         )
      `,
      [episodeId, videoId, episodeId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  const [byEpisode] = await db.execute<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS c
    FROM user_materialized_sections
    WHERE episode_id = ?
    `,
    [episodeId],
  );
  return Number(byEpisode[0]?.c ?? 0);
}

async function loadEpisodeContext(
  episodeId: string,
  db: DbExecutor,
): Promise<EpisodeContentResetContext> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT
      CAST(e.id AS CHAR) AS episodeId,
      e.title AS episodeTitle,
      CAST(s.video_id AS CHAR) AS videoId,
      v.name AS videoName
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    LEFT JOIN videos v ON v.id = s.video_id
    WHERE e.id = ?
    LIMIT 1
    `,
    [episodeId],
  );
  if (rows.length === 0) {
    throw new Error(`Episode not found: ${episodeId}`);
  }

  const [partRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT
      SUM(CASE WHEN retired_at IS NULL THEN 1 ELSE 0 END) AS activeParts,
      SUM(CASE WHEN retired_at IS NOT NULL THEN 1 ELSE 0 END) AS retiredParts
    FROM parts
    WHERE episode_id = ?
    `,
    [episodeId],
  );

  return {
    episodeId: String(rows[0]!.episodeId),
    episodeTitle: rows[0]!.episodeTitle ? String(rows[0]!.episodeTitle) : null,
    videoId: rows[0]!.videoId ? String(rows[0]!.videoId) : null,
    videoName: rows[0]!.videoName ? String(rows[0]!.videoName) : null,
    activeParts: Number(partRows[0]?.activeParts ?? 0),
    retiredParts: Number(partRows[0]?.retiredParts ?? 0),
  };
}

/** Pure helper — unit-tested without DB. */
export function buildLearnerProgressBlockers(
  impact: Pick<
    EpisodeResetImpact,
    | "willDeleteUserPartProgress"
    | "willDeleteUserTokenMarks"
    | "willDeleteSavedVocabularyCards"
  >,
): string[] {
  const blockers: string[] = [];
  if (impact.willDeleteUserPartProgress > 0) {
    blockers.push(
      `user_part_progress: ${impact.willDeleteUserPartProgress} row(s)`,
    );
  }
  if (impact.willDeleteUserTokenMarks > 0) {
    blockers.push(`user_token_marks: ${impact.willDeleteUserTokenMarks} row(s)`);
  }
  if (impact.willDeleteSavedVocabularyCards > 0) {
    blockers.push(
      `saved_vocabulary_cards: ${impact.willDeleteSavedVocabularyCards} row(s)`,
    );
  }
  return blockers;
}

export function isEpisodeResetAllowed(
  learnerProgressBlockers: string[],
  options: EpisodeContentResetOptions = {},
): boolean {
  return (
    learnerProgressBlockers.length === 0 ||
    options.confirmDiscardLearnerProgress === true
  );
}

async function buildCounts(
  episodeId: string,
  db: DbExecutor,
): Promise<EpisodeContentResetCounts> {
  const impact = await countEpisodeResetImpact(episodeId, db);
  return {
    ...impact,
    willDeleteUserMaterializedSections:
      await countMaterializedSectionsForEpisode(episodeId, db),
  };
}

export async function previewTestEpisodeContentReset(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
  options: EpisodeContentResetOptions = {},
): Promise<EpisodeContentResetPreview> {
  await assertEpisodeExists(episodeId, db);
  const context = await loadEpisodeContext(episodeId, db);
  const counts = await buildCounts(episodeId, db);
  const learnerProgressBlockers = buildLearnerProgressBlockers(counts);
  const discardProgress = options.confirmDiscardLearnerProgress === true;

  return {
    dryRun: true,
    context,
    counts,
    learnerProgressBlockers,
    allowed: isEpisodeResetAllowed(learnerProgressBlockers, options),
    notes: [
      "Episodes/seasons/videos rows are not deleted.",
      "Global dictionary_entries / grammar_concepts are not deleted.",
      "Content-sync plans are not stored in the database.",
      "After reset, run content-import in insert mode for a clean catalog.",
      ...(discardProgress && learnerProgressBlockers.length > 0
        ? [
            "confirmDiscardLearnerProgress: learner progress rows will be deleted with parts.",
          ]
        : []),
    ],
  };
}

/**
 * Test-episode content wipe: removes all parts and attachments for one episode.
 * Blocks when learner progress exists (progress, token marks, saved vocab cards).
 */
export async function applyTestEpisodeContentReset(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
  options: EpisodeContentResetOptions = {},
): Promise<EpisodeContentResetApplyResult> {
  const preview = await previewTestEpisodeContentReset(episodeId, db, options);
  if (!preview.allowed) {
    throw new EpisodeContentResetBlockedError(preview);
  }

  const pool = getContentSyncPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const countsBefore = await buildCounts(episodeId, conn);
    const { partsDeleted } = await resetEpisodeParts(episodeId, conn);
    await conn.commit();

    return {
      dryRun: false,
      context: preview.context,
      countsBefore,
      partsDeleted,
      materializedSectionsDeleted:
        countsBefore.willDeleteUserMaterializedSections,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
