import { pool } from "@/lib/db/connection";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export type UserVocabularyReviewState = "new" | "learning" | "review" | "mastered";

export type UserVocabularyRow = RowDataPacket & {
  id: number;
  user_id: string;
  dictionary_entry_id: string;
  review_state: UserVocabularyReviewState;
  next_review_at: Date;
  review_count: number;
  added_at: Date;
  updated_at: Date;
};

export type UserVocabularyCamel = {
  id: number;
  userId: string;
  dictionaryEntryId: string;
  reviewState: UserVocabularyReviewState;
  nextReviewAt: Date;
  reviewCount: number;
  addedAt: Date;
  updatedAt: Date;
};

function toCamel(row: UserVocabularyRow): UserVocabularyCamel {
  return {
    id: row.id,
    userId: row.user_id,
    dictionaryEntryId: row.dictionary_entry_id,
    reviewState: row.review_state,
    nextReviewAt: row.next_review_at,
    reviewCount: row.review_count,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

function initialNextReviewAt(): Date {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next;
}

export async function isDictionaryEntrySavedByUser(
  userId: string,
  dictionaryEntryId: string,
): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT 1
    FROM user_vocabulary
    WHERE user_id = ?
      AND dictionary_entry_id = ?
    LIMIT 1
    `,
    [userId, dictionaryEntryId],
  );
  return rows.length > 0;
}

export async function listSavedDictionaryEntryIdsForUser(
  userId: string,
): Promise<Set<string>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT dictionary_entry_id
    FROM user_vocabulary
    WHERE user_id = ?
    `,
    [userId],
  );
  return new Set(rows.map((row) => String(row.dictionary_entry_id)));
}

export async function upsertUserVocabularyEntry(
  userId: string,
  dictionaryEntryId: string,
): Promise<{ row: UserVocabularyCamel; created: boolean }> {
  const [existingRows] = await pool.execute<UserVocabularyRow[]>(
    `
    SELECT *
    FROM user_vocabulary
    WHERE user_id = ?
      AND dictionary_entry_id = ?
    LIMIT 1
    `,
    [userId, dictionaryEntryId],
  );

  if (existingRows[0]) {
    return { row: toCamel(existingRows[0]), created: false };
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO user_vocabulary (
      user_id,
      dictionary_entry_id,
      review_state,
      next_review_at,
      review_count,
      added_at,
      updated_at
    )
    VALUES (?, ?, 'new', ?, 0, NOW(3), NOW(3))
    `,
    [userId, dictionaryEntryId, initialNextReviewAt()],
  );

  const [createdRows] = await pool.execute<UserVocabularyRow[]>(
    `
    SELECT *
    FROM user_vocabulary
    WHERE id = ?
    LIMIT 1
    `,
    [result.insertId],
  );

  if (!createdRows[0]) {
    throw new Error("Failed to load created user vocabulary row");
  }

  return { row: toCamel(createdRows[0]), created: true };
}

export function userVocabularyToJson(row: UserVocabularyCamel) {
  return {
    id: row.id,
    userId: row.userId,
    dictionaryEntryId: row.dictionaryEntryId,
    reviewState: row.reviewState,
    nextReviewAt: row.nextReviewAt.toISOString(),
    reviewCount: row.reviewCount,
    addedAt: row.addedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
