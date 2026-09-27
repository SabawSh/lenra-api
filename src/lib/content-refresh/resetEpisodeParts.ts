import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getContentSyncPool } from "../content-sync/syncDb";
import { deleteMaterializedSectionsForEpisode } from "@/lib/dev/resetLearningState";

export type DbExecutor = Pool | PoolConnection;

/**
 * Live MySQL (verified via information_schema): FKs referencing `parts.id`.
 *
 * Explicit delete required (DELETE_RULE = NO ACTION / RESTRICT):
 * - user_part_progress.part_id
 * - user_token_marks.part_id
 * - saved_vocabulary_cards.clip_id
 *
 * Cascades automatically when parts are deleted:
 * - caption_translations
 * - part_dictionary_entries
 * - part_grammar_occurrences
 * - part_vocabulary_occurrences
 * - user_reminders
 * - user_materialized_section_atomic_parts
 * - user_materialized_section_learning_unit_parts
 * - user_materialized_section_progression_unit_parts
 *
 * No FK (won't block delete; cleared for cleanliness):
 * - learning_bug_reports.part_id (nullable)
 */
export type EpisodeResetImpact = {
  willDeleteParts: number;
  /** Explicit — FK NO ACTION */
  willDeleteUserPartProgress: number;
  willDeleteUserTokenMarks: number;
  willDeleteSavedVocabularyCards: number;
  /** Cascade — removed when parts are deleted */
  willDeleteCaptionTranslations: number;
  willDeleteUserReminders: number;
  willDeletePartDictionaryEntries: number;
  willDeletePartGrammarOccurrences: number;
  willDeletePartVocabularyOccurrences: number;
  willDeleteUserMaterializedSectionAtomicParts: number;
  willDeleteUserMaterializedSectionLearningUnitParts: number;
  willDeleteUserMaterializedSectionProgressionUnitParts: number;
  /** No FK — part_id nulled */
  willClearLearningBugReportPartIds: number;
};

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

async function countJoinParts(
  db: DbExecutor,
  table: string,
  partColumn: string,
  episodeId: string,
): Promise<number> {
  if (!(await tableExists(db, table))) return 0;
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS c
    FROM \`${table}\` x
    INNER JOIN parts p ON p.id = x.\`${partColumn}\`
    WHERE p.episode_id = ?
    `,
    [episodeId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function assertEpisodeExists(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id FROM episodes WHERE id = ? LIMIT 1`,
    [episodeId],
  );
  if (rows.length === 0) {
    throw new Error(`Episode not found: ${episodeId}`);
  }
}

export async function countPartsForEpisode(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM parts WHERE episode_id = ?`,
    [episodeId],
  );
  return Number(rows[0]?.c ?? 0);
}

export async function countEpisodeResetImpact(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
): Promise<EpisodeResetImpact> {
  const willDeleteParts = await countPartsForEpisode(episodeId, db);

  let willClearLearningBugReportPartIds = 0;
  if (await tableExists(db, "learning_bug_reports")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM learning_bug_reports lbr
      INNER JOIN parts p ON p.id = lbr.part_id
      WHERE p.episode_id = ?
      `,
      [episodeId],
    );
    willClearLearningBugReportPartIds = Number(rows[0]?.c ?? 0);
  }

  return {
    willDeleteParts,
    willDeleteUserPartProgress: await countJoinParts(
      db,
      "user_part_progress",
      "part_id",
      episodeId,
    ),
    willDeleteUserTokenMarks: await countJoinParts(
      db,
      "user_token_marks",
      "part_id",
      episodeId,
    ),
    willDeleteSavedVocabularyCards: await countJoinParts(
      db,
      "saved_vocabulary_cards",
      "clip_id",
      episodeId,
    ),
    willDeleteCaptionTranslations: await countJoinParts(
      db,
      "caption_translations",
      "part_id",
      episodeId,
    ),
    willDeleteUserReminders: await countJoinParts(
      db,
      "user_reminders",
      "part_id",
      episodeId,
    ),
    willDeletePartDictionaryEntries: await countJoinParts(
      db,
      "part_dictionary_entries",
      "part_id",
      episodeId,
    ),
    willDeletePartGrammarOccurrences: await countJoinParts(
      db,
      "part_grammar_occurrences",
      "part_id",
      episodeId,
    ),
    willDeletePartVocabularyOccurrences: await countJoinParts(
      db,
      "part_vocabulary_occurrences",
      "part_id",
      episodeId,
    ),
    willDeleteUserMaterializedSectionAtomicParts: await countJoinParts(
      db,
      "user_materialized_section_atomic_parts",
      "part_id",
      episodeId,
    ),
    willDeleteUserMaterializedSectionLearningUnitParts: await countJoinParts(
      db,
      "user_materialized_section_learning_unit_parts",
      "part_id",
      episodeId,
    ),
    willDeleteUserMaterializedSectionProgressionUnitParts: await countJoinParts(
      db,
      "user_materialized_section_progression_unit_parts",
      "part_id",
      episodeId,
    ),
    willClearLearningBugReportPartIds,
  };
}

async function deleteJoinParts(
  db: DbExecutor,
  table: string,
  partColumn: string,
  episodeId: string,
): Promise<number> {
  if (!(await tableExists(db, table))) return 0;
  const [result] = await db.execute<ResultSetHeader>(
    `
    DELETE x
    FROM \`${table}\` x
    INNER JOIN parts p ON p.id = x.\`${partColumn}\`
    WHERE p.episode_id = ?
    `,
    [episodeId],
  );
  return result.affectedRows;
}

/**
 * Episode-scoped destructive reset:
 * 1) Explicitly delete NO ACTION FK dependents
 * 2) Clear nullable non-FK part refs
 * 3) Delete parts (CASCADE dependents follow)
 *
 * WARNING: This hard-wipes parts.id and learner progress. Admin Content Import
 * replace mode NO LONGER calls this — it uses progress-preserving sync
 * (`safeContentReplace` + content-sync). Keep this only for explicit
 * development wipe tooling that intentionally destroys learner state.
 */
export async function resetEpisodeParts(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
): Promise<{ partsDeleted: number; impact: EpisodeResetImpact }> {
  const impact = await countEpisodeResetImpact(episodeId, db);

  await deleteJoinParts(db, "user_part_progress", "part_id", episodeId);
  await deleteJoinParts(db, "user_token_marks", "part_id", episodeId);
  await deleteJoinParts(db, "saved_vocabulary_cards", "clip_id", episodeId);

  if (await tableExists(db, "learning_bug_reports")) {
    await db.execute<ResultSetHeader>(
      `
      UPDATE learning_bug_reports lbr
      INNER JOIN parts p ON p.id = lbr.part_id
      SET lbr.part_id = NULL
      WHERE p.episode_id = ?
      `,
      [episodeId],
    );
  }

  // Hollow headers survive part CASCADE — delete them before parts so rematerialization works.
  await deleteMaterializedSectionsForEpisode(episodeId, db);

  const [result] = await db.execute<ResultSetHeader>(
    `DELETE FROM parts WHERE episode_id = ?`,
    [episodeId],
  );

  return {
    partsDeleted: result.affectedRows || impact.willDeleteParts,
    impact,
  };
}

/** @deprecated use resetEpisodeParts */
export async function deletePartsForEpisode(
  episodeId: string,
): Promise<number> {
  const { partsDeleted } = await resetEpisodeParts(episodeId);
  return partsDeleted;
}
