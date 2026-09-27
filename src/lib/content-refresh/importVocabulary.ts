import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { DbExecutor } from "./resetEpisodeParts";
import type {
  VocabularyOccurrenceEntry,
  VocabularySenseEntry,
} from "./types";

export type ImportVocabularyResult = {
  sensesUpserted: number;
  occurrencesImported: number;
  fromLearningAnalysis: number;
  fromOccurrencesFile: number;
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

/**
 * Upsert dictionary entries/senses from vocabulary-senses.json.
 * Uses pipeline senseId as dictionary_senses.id (stable, lookup-friendly).
 * Idempotent on repeated development imports.
 */
export async function upsertVocabularySenses(
  senses: VocabularySenseEntry[],
  db: DbExecutor = getContentSyncPool(),
): Promise<number> {
  const hasSensesTable = await tableExists(db, "dictionary_senses");
  const hasExamplesTable = await tableExists(db, "dictionary_examples");

  let upserted = 0;

  for (const sense of senses) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `
      SELECT CAST(id AS CHAR) AS id
      FROM dictionary_entries
      WHERE lemma = ? AND language = 'en'
      LIMIT 1
      `,
      [sense.lemma],
    );

    let entryId = existing[0] ? String(existing[0].id) : null;
    // Live DB (lemma/sense split): POS + definitions live on dictionary_senses only.
    if (!entryId) {
      entryId = randomUUID();
      await db.execute<ResultSetHeader>(
        `
        INSERT INTO dictionary_entries (
          id, lemma, language, entry_type, cefr_level,
          source, created_at, updated_at
        ) VALUES (?, ?, 'en', ?, ?, 'content-pipeline', NOW(3), NOW(3))
        `,
        [
          entryId,
          sense.lemma,
          sense.kind === "phrase" ? "phrase" : "word",
          sense.cefr,
        ],
      );
    } else {
      await db.execute<ResultSetHeader>(
        `
        UPDATE dictionary_entries
        SET
          entry_type = ?,
          cefr_level = COALESCE(?, cefr_level),
          source = 'content-pipeline',
          updated_at = NOW(3)
        WHERE id = ?
        `,
        [
          sense.kind === "phrase" ? "phrase" : "word",
          sense.cefr,
          entryId,
        ],
      );
    }

    if (hasSensesTable) {
      const [existingSense] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM dictionary_senses WHERE id = ? LIMIT 1`,
        [sense.senseId],
      );

      if (existingSense.length > 0) {
        await db.execute<ResultSetHeader>(
          `
          UPDATE dictionary_senses
          SET
            dictionary_entry_id = ?,
            part_of_speech = ?,
            cefr_level = ?,
            definition_en = ?,
            definition_fa = ?,
            updated_at = NOW(3)
          WHERE id = ?
          `,
          [
            entryId,
            sense.partOfSpeech ?? "unknown",
            sense.cefr,
            sense.meaningEn || "",
            sense.meaningFa || "",
            sense.senseId,
          ],
        );
      } else {
        const [orderRows] = await db.execute<RowDataPacket[]>(
          `
          SELECT COALESCE(MAX(sense_order), -1) + 1 AS nextOrder
          FROM dictionary_senses
          WHERE dictionary_entry_id = ?
          `,
          [entryId],
        );
        const senseOrder = Number(orderRows[0]?.nextOrder ?? 0);
        await db.execute<ResultSetHeader>(
          `
          INSERT INTO dictionary_senses (
            id, dictionary_entry_id, sense_order, part_of_speech, cefr_level,
            definition_en, definition_fa, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
          `,
          [
            sense.senseId,
            entryId,
            senseOrder,
            sense.partOfSpeech ?? "unknown",
            sense.cefr,
            sense.meaningEn || "",
            sense.meaningFa || "",
          ],
        );
      }

      if (sense.exampleSentence && hasExamplesTable) {
        const [exRows] = await db.execute<RowDataPacket[]>(
          `
          SELECT id FROM dictionary_examples
          WHERE dictionary_sense_id = ? AND example_order = 0
          LIMIT 1
          `,
          [sense.senseId],
        );
        if (exRows.length === 0) {
          await db.execute<ResultSetHeader>(
            `
            INSERT INTO dictionary_examples (
              id, dictionary_sense_id, example_order, text_en, text_fa, created_at
            ) VALUES (?, ?, 0, ?, ?, NOW(3))
            `,
            [
              randomUUID(),
              sense.senseId,
              sense.exampleSentence,
              sense.exampleTranslation ?? "",
            ],
          );
        } else {
          await db.execute<ResultSetHeader>(
            `
            UPDATE dictionary_examples
            SET text_en = ?, text_fa = ?
            WHERE dictionary_sense_id = ? AND example_order = 0
            `,
            [
              sense.exampleSentence,
              sense.exampleTranslation ?? "",
              sense.senseId,
            ],
          );
        }
      }
    }

    upserted += 1;
  }

  return upserted;
}

/**
 * Attach vocabulary occurrences to parts by canonicalKey.
 * Also links part_dictionary_entries and stamps senseId onto matching tokens when possible.
 */
export async function importVocabularyOccurrencesForEpisode(
  episodeId: string,
  occurrences: VocabularyOccurrenceEntry[],
  clipCanonicalKeys: Set<string>,
  db: DbExecutor = getContentSyncPool(),
): Promise<{ imported: number; matchedClipEntries: number }> {
  const hasOccTable = await tableExists(db, "part_vocabulary_occurrences");
  const hasJunction = await tableExists(db, "part_dictionary_entries");
  const hasSensesTable = await tableExists(db, "dictionary_senses");

  const relevant = occurrences.filter(
    (e) =>
      clipCanonicalKeys.has(e.canonicalKey) && e.occurrences.length > 0,
  );

  const [partRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT
      CAST(id AS CHAR) AS id,
      canonical_key AS canonicalKey,
      tokens
    FROM parts
    WHERE episode_id = ?
      AND canonical_key IS NOT NULL
      AND retired_at IS NULL
    `,
    [episodeId],
  );

  const partsByKey = new Map<
    string,
    Array<{ id: string; tokens: unknown }>
  >();
  for (const row of partRows) {
    const key = String(row.canonicalKey);
    const list = partsByKey.get(key) ?? [];
    list.push({ id: String(row.id), tokens: row.tokens });
    partsByKey.set(key, list);
  }

  let imported = 0;

  for (const entry of relevant) {
    const parts = partsByKey.get(entry.canonicalKey) ?? [];
    for (const part of parts) {
      for (const occ of entry.occurrences) {
        if (hasOccTable) {
          await db.execute<ResultSetHeader>(
            `
            INSERT INTO part_vocabulary_occurrences (
              id, part_id, sense_id, surface, evidence_span, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(3))
            `,
            [
              randomUUID(),
              part.id,
              occ.senseId,
              occ.surface,
              occ.evidenceSpan,
              occ.confidence,
            ],
          );
        }

        if (hasJunction && hasSensesTable) {
          const [senseRows] = await db.execute<RowDataPacket[]>(
            `
            SELECT CAST(dictionary_entry_id AS CHAR) AS entryId
            FROM dictionary_senses
            WHERE id = ?
            LIMIT 1
            `,
            [occ.senseId],
          );
          const entryId = senseRows[0]
            ? String(senseRows[0].entryId)
            : null;
          if (entryId) {
            await db.execute<ResultSetHeader>(
              `
              INSERT INTO part_dictionary_entries (
                part_id, dictionary_entry_id, frequency, created_at
              ) VALUES (?, ?, 1, NOW(3))
              ON DUPLICATE KEY UPDATE frequency = frequency + 1
              `,
              [part.id, entryId],
            );
          }
        }

        // Stamp senseId onto matching token surfaces when present.
        const tokens = normalizeTokens(part.tokens);
        if (tokens.length > 0 && occ.surface) {
          const surface = occ.surface.toLowerCase();
          let changed = false;
          for (const token of tokens) {
            const value = String(
              token.value ?? token.text ?? "",
            ).toLowerCase();
            if (value === surface && !token.senseId) {
              token.senseId = occ.senseId;
              changed = true;
            }
          }
          if (changed) {
            await db.execute<ResultSetHeader>(
              `UPDATE parts SET tokens = CAST(? AS JSON) WHERE id = ?`,
              [JSON.stringify(tokens), part.id],
            );
            part.tokens = tokens;
          }
        }

        imported += 1;
      }
    }
  }

  return { imported, matchedClipEntries: relevant.length };
}

function normalizeTokens(raw: unknown): Array<Record<string, unknown>> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw as Array<Record<string, unknown>>;
  }
  return [];
}
