import { randomUUID } from "node:crypto";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { lemmatizeWord } from "@/lib/dictionary/lemmatizeWord";
import { normalizeDictionaryLookupSurface } from "@/lib/dictionary/normalizeDictionaryLemma";

export type DictionaryCoverageEnsureResult = {
  eligibleLemmaCount: number;
  alreadyCovered: number;
  pendingEntriesEnsured: number;
  generationJobsCreated: number;
  duplicateJobsAvoided: number;
};

type DictionaryEntryStatusRow = RowDataPacket & {
  id: string;
  status: string | null;
  source: string | null;
  sense_count: number;
};

function isEntryPending(row: DictionaryEntryStatusRow): boolean {
  const status = row.status?.trim().toLowerCase();
  if (status === "pending") {
    return true;
  }
  const source = row.source?.trim().toLowerCase();
  return source === "pending";
}

function isEntryReady(row: DictionaryEntryStatusRow): boolean {
  if (isEntryPending(row)) {
    return false;
  }
  return Number(row.sense_count) > 0;
}

async function fetchEntryStatus(
  conn: PoolConnection,
  lemma: string,
  language: string,
): Promise<DictionaryEntryStatusRow | undefined> {
  const queries = [
    `
    SELECT
      de.id,
      de.status,
      de.source,
      (
        SELECT COUNT(*)
        FROM dictionary_senses ds
        WHERE ds.dictionary_entry_id = de.id
      ) AS sense_count
    FROM dictionary_entries de
    WHERE de.lemma = ? AND de.language = ?
    LIMIT 1
    `,
    `
    SELECT
      de.id,
      NULL AS status,
      de.source,
      (
        SELECT COUNT(*)
        FROM dictionary_senses ds
        WHERE ds.dictionary_entry_id = de.id
      ) AS sense_count
    FROM dictionary_entries de
    WHERE de.lemma = ? AND de.language = ?
    LIMIT 1
    `,
  ];

  for (const sql of queries) {
    try {
      const [rows] = await conn.execute<DictionaryEntryStatusRow[]>(sql, [
        lemma,
        language,
      ]);
      return rows[0];
    } catch (error) {
      const code =
        error && typeof error === "object"
          ? (error as { code?: string }).code
          : undefined;
      if (code === "ER_BAD_FIELD_ERROR") {
        continue;
      }
      throw error;
    }
  }

  return undefined;
}

async function insertPendingDictionaryEntryOnConnection(
  conn: PoolConnection,
  lemma: string,
  language: string,
): Promise<void> {
  const id = randomUUID();
  try {
    await conn.execute(
      `
      INSERT INTO dictionary_entries (
        id, lemma, language, status, created_at, updated_at
      )
      VALUES (?, ?, ?, 'pending', NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE updated_at = NOW(3)
      `,
      [id, lemma, language],
    );
    return;
  } catch (error) {
    const code =
      error && typeof error === "object"
        ? (error as { code?: string }).code
        : undefined;
    if (code !== "ER_BAD_FIELD_ERROR") {
      throw error;
    }
  }

  await conn.execute(
    `
    INSERT INTO dictionary_entries (
      id, lemma, language, source, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE updated_at = NOW(3)
    `,
    [id, lemma, language],
  );
}

async function enqueueDictionaryJobOnConnection(
  conn: PoolConnection,
  lemma: string,
  language: string,
): Promise<{ created: boolean }> {
  const [result] = await conn.execute(
    `
    INSERT INTO dictionary_generation_jobs (
      id, lemma, language, status, attempts, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', 0, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE id = id
    `,
    [randomUUID(), lemma, language],
  );
  const header = result as { affectedRows?: number };
  return { created: (header.affectedRows ?? 0) === 1 };
}

async function generationJobExists(
  conn: PoolConnection,
  lemma: string,
  language: string,
): Promise<boolean> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `
    SELECT id
    FROM dictionary_generation_jobs
    WHERE lemma = ? AND language = ?
    LIMIT 1
    `,
    [lemma, language],
  );
  return rows.length > 0;
}

/**
 * Ensure dictionary rows / generation jobs exist for clip inventory lemmas.
 * Does not create vocabulary occurrences or assign senseId on tokens.
 */
export async function ensureDictionaryCoverageForLemmas(
  conn: PoolConnection,
  rawLemmas: readonly string[],
  language = "en",
): Promise<DictionaryCoverageEnsureResult> {
  const lemmas = [
    ...new Set(
      rawLemmas
        .map((lemma) =>
          lemmatizeWord(normalizeDictionaryLookupSurface(lemma)),
        )
        .filter(Boolean),
    ),
  ].sort();

  let alreadyCovered = 0;
  let pendingEntriesEnsured = 0;
  let generationJobsCreated = 0;
  let duplicateJobsAvoided = 0;

  for (const lemma of lemmas) {
    let row = await fetchEntryStatus(conn, lemma, language);
    if (row && isEntryReady(row)) {
      alreadyCovered += 1;
      continue;
    }

    if (!row) {
      await insertPendingDictionaryEntryOnConnection(conn, lemma, language);
      row = await fetchEntryStatus(conn, lemma, language);
      pendingEntriesEnsured += 1;
    }

    const hadJob = await generationJobExists(conn, lemma, language);
    const { created } = await enqueueDictionaryJobOnConnection(
      conn,
      lemma,
      language,
    );
    if (created) {
      generationJobsCreated += 1;
    } else if (hadJob) {
      duplicateJobsAvoided += 1;
    } else {
      duplicateJobsAvoided += 1;
    }
  }

  return {
    eligibleLemmaCount: lemmas.length,
    alreadyCovered,
    pendingEntriesEnsured,
    generationJobsCreated,
    duplicateJobsAvoided,
  };
}
