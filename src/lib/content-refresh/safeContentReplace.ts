/**
 * Progress-preserving content replacement.
 *
 * Parts identity: preserve `parts.id` when canonicalKey matches (content-sync).
 * Learner state keyed by parts.id is never hard-deleted by this path.
 * Removed keys are soft-retired (`retired_at`) so progress remains historical.
 * Content attachments (translations / vocab / grammar) are DELETE_AND_REBUILD
 * onto active parts only.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { buildContentSyncPlan } from "../content-sync/buildContentSyncPlan";
import type { DbExecutor } from "./resetEpisodeParts";
import type {
  ContentSyncPlan,
  ExistingSyncPart,
  PipelineClip,
} from "../content-sync/types";

export type TableReplaceClass =
  | "PRESERVE_BY_PART_ID"
  | "REMAP_BY_CANONICAL_KEY"
  | "DELETE_AND_REBUILD"
  | "DELETE_ONLY_IF_PART_REMOVED"
  | "MUST_NOT_BE_DELETED";

/** Documented classification for parts.id dependents (replace path). */
export const PARTS_ID_TABLE_CLASSIFICATION: Record<string, TableReplaceClass> = {
  user_part_progress: "PRESERVE_BY_PART_ID",
  user_token_marks: "PRESERVE_BY_PART_ID",
  user_reminders: "PRESERVE_BY_PART_ID",
  saved_vocabulary_cards: "PRESERVE_BY_PART_ID",
  caption_translations: "DELETE_AND_REBUILD",
  part_vocabulary_occurrences: "DELETE_AND_REBUILD",
  part_grammar_occurrences: "DELETE_AND_REBUILD",
  part_dictionary_entries: "DELETE_AND_REBUILD",
  user_materialized_section_atomic_parts: "DELETE_AND_REBUILD",
  user_materialized_section_learning_unit_parts: "DELETE_AND_REBUILD",
  user_materialized_section_progression_unit_parts: "DELETE_AND_REBUILD",
  learning_bug_reports: "DELETE_ONLY_IF_PART_REMOVED",
  user_learning_resume: "MUST_NOT_BE_DELETED",
  adaptive_teacher_events: "MUST_NOT_BE_DELETED",
  user_adaptive_skill_sections: "MUST_NOT_BE_DELETED",
};

export type SafeReplaceLearnerImpact = {
  progressOnPreservedParts: number;
  tokenMarksOnPreservedParts: number;
  savedCardsOnPreservedParts: number;
  remindersOnPreservedParts: number;
  progressOnRetiredParts: number;
  tokenMarksOnRetiredParts: number;
  savedCardsOnRetiredParts: number;
  remindersOnRetiredParts: number;
  /** Hard-delete loss; always 0 on the soft-retire path. */
  potentialLearnerStateLoss: number;
  /** Rows that would need a product policy if we hard-deleted retires. */
  learnerProgressRowsRequiringExplicitPolicy: number;
};

export type SafeReplacePreview = {
  existingPartsPreserved: number;
  newPartsCreated: number;
  partsSoftRetired: number;
  partsHardDeleted: number;
  learnerProgressRowsPreserved: number;
  learnerProgressRowsRemapped: number;
  learnerProgressRowsRequiringExplicitPolicy: number;
  learnerProgressRowsOnSoftRetiredParts: number;
  translationsUpdated: number;
  grammarRowsRebuilt: number;
  vocabularyRowsRebuilt: number;
  potentialLearnerStateLoss: number;
  ambiguousMatchCount: number;
  wouldApplyBeSafe: boolean;
  safetyBlockers: string[];
  learnerImpact: SafeReplaceLearnerImpact;
  plan: ContentSyncPlan;
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

async function countJoinPartIds(
  db: DbExecutor,
  table: string,
  partColumn: string,
  partIds: string[],
): Promise<number> {
  if (partIds.length === 0) return 0;
  if (!(await tableExists(db, table))) return 0;
  const placeholders = partIds.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT COUNT(*) AS c
    FROM \`${table}\`
    WHERE \`${partColumn}\` IN (${placeholders})
    `,
    partIds,
  );
  return Number(rows[0]?.c ?? 0);
}

export async function countLearnerStateForPartIds(
  db: DbExecutor,
  partIds: string[],
): Promise<{
  progress: number;
  tokenMarks: number;
  savedCards: number;
  reminders: number;
}> {
  return {
    progress: await countJoinPartIds(
      db,
      "user_part_progress",
      "part_id",
      partIds,
    ),
    tokenMarks: await countJoinPartIds(
      db,
      "user_token_marks",
      "part_id",
      partIds,
    ),
    savedCards: await countJoinPartIds(
      db,
      "saved_vocabulary_cards",
      "clip_id",
      partIds,
    ),
    reminders: await countJoinPartIds(db, "user_reminders", "part_id", partIds),
  };
}

/**
 * Build the safe-replace preview from a sync plan + live learner-state counts.
 */
export async function buildSafeReplacePreview(args: {
  plan: ContentSyncPlan;
  db: DbExecutor;
  translationEntries: number;
  grammarRowsWouldImport: number;
  vocabularyRowsWouldImport: number;
}): Promise<SafeReplacePreview> {
  const preservedIds = args.plan.matches.map((m) => m.partId);
  const retiredIds = args.plan.retires.map((r) => r.partId);

  const onPreserved = await countLearnerStateForPartIds(args.db, preservedIds);
  const onRetired = await countLearnerStateForPartIds(args.db, retiredIds);

  const safetyBlockers: string[] = [];
  if (args.plan.ambiguousMatches.length > 0) {
    safetyBlockers.push(
      `${args.plan.ambiguousMatches.length} ambiguous canonicalKey match(es)`,
    );
  }

  // Soft-retire preserves learner rows on removed keys — not loss.
  const potentialLearnerStateLoss = 0;
  const learnerProgressRowsRequiringExplicitPolicy = 0;

  const wouldApplyBeSafe =
    safetyBlockers.length === 0 && potentialLearnerStateLoss === 0;

  return {
    existingPartsPreserved: args.plan.matches.length,
    newPartsCreated: args.plan.inserts.length,
    partsSoftRetired: args.plan.retires.length,
    partsHardDeleted: 0,
    learnerProgressRowsPreserved: onPreserved.progress,
    learnerProgressRowsRemapped: 0,
    learnerProgressRowsRequiringExplicitPolicy,
    learnerProgressRowsOnSoftRetiredParts: onRetired.progress,
    translationsUpdated: args.translationEntries,
    grammarRowsRebuilt: args.grammarRowsWouldImport,
    vocabularyRowsRebuilt: args.vocabularyRowsWouldImport,
    potentialLearnerStateLoss,
    ambiguousMatchCount: args.plan.ambiguousMatches.length,
    wouldApplyBeSafe,
    safetyBlockers,
    learnerImpact: {
      progressOnPreservedParts: onPreserved.progress,
      tokenMarksOnPreservedParts: onPreserved.tokenMarks,
      savedCardsOnPreservedParts: onPreserved.savedCards,
      remindersOnPreservedParts: onPreserved.reminders,
      progressOnRetiredParts: onRetired.progress,
      tokenMarksOnRetiredParts: onRetired.tokenMarks,
      savedCardsOnRetiredParts: onRetired.savedCards,
      remindersOnRetiredParts: onRetired.reminders,
      potentialLearnerStateLoss,
      learnerProgressRowsRequiringExplicitPolicy,
    },
    plan: args.plan,
  };
}

export function planSafeContentReplace(args: {
  episodeId: string;
  pipelineClips: PipelineClip[];
  existingParts: ExistingSyncPart[];
  dryRun?: boolean;
}): ContentSyncPlan {
  return buildContentSyncPlan({
    episodeId: args.episodeId,
    pipelineClips: args.pipelineClips,
    existingParts: args.existingParts,
    dryRun: args.dryRun,
  });
}

/**
 * Wipe content attachments for active (non-retired) parts only.
 * Does not touch learner progress / token marks / saved cards / reminders.
 */
export async function deleteContentAttachmentsForActiveParts(
  episodeId: string,
  db: DbExecutor,
): Promise<{
  translations: number;
  grammarOccurrences: number;
  vocabularyOccurrences: number;
  dictionaryEntries: number;
}> {
  const counts = {
    translations: 0,
    grammarOccurrences: 0,
    vocabularyOccurrences: 0,
    dictionaryEntries: 0,
  };

  const joinDelete = async (table: string, column: string) => {
    if (!(await tableExists(db, table))) return 0;
    const [result] = await db.execute<ResultSetHeader>(
      `
      DELETE x
      FROM \`${table}\` x
      INNER JOIN parts p ON p.id = x.\`${column}\`
      WHERE p.episode_id = ?
        AND p.retired_at IS NULL
      `,
      [episodeId],
    );
    return result.affectedRows;
  };

  counts.translations = await joinDelete("caption_translations", "part_id");
  counts.grammarOccurrences = await joinDelete(
    "part_grammar_occurrences",
    "part_id",
  );
  counts.vocabularyOccurrences = await joinDelete(
    "part_vocabulary_occurrences",
    "part_id",
  );
  counts.dictionaryEntries = await joinDelete(
    "part_dictionary_entries",
    "part_id",
  );

  return counts;
}

/**
 * In-transaction invariant: every matched part id still exists with the same id.
 */
export async function assertPreservedPartIds(
  db: DbExecutor,
  preservedPartIds: string[],
): Promise<void> {
  if (preservedPartIds.length === 0) return;
  const placeholders = preservedPartIds.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(id AS CHAR) AS id
    FROM parts
    WHERE id IN (${placeholders})
      AND retired_at IS NULL
    `,
    preservedPartIds,
  );
  const found = new Set(rows.map((r) => String(r.id)));
  const missing = preservedPartIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Safe replace invariant failed: ${missing.length} preserved part id(s) missing after sync ` +
        `(example: ${missing[0]})`,
    );
  }
}
