import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { DbExecutor } from "./resetEpisodeParts";
import type {
  GrammarCatalogEntry,
  GrammarOccurrenceEntry,
} from "./types";

export type ImportGrammarResult = {
  conceptsUpserted: number;
  stubConceptsCreated: number;
  occurrencesImported: number;
};

async function ensureGrammarConcept(
  grammarId: string,
  catalogById: Map<string, GrammarCatalogEntry>,
  db: DbExecutor,
): Promise<"catalog" | "stub"> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM grammar_concepts WHERE id = ? LIMIT 1`,
    [grammarId],
  );
  if (existing.length > 0) return "catalog";

  const catalog = catalogById.get(grammarId);
  if (catalog) {
    await db.execute<ResultSetHeader>(
      `
      INSERT INTO grammar_concepts (
        id, display_name_en, display_name_fa, category, subcategory,
        cefr_min, cefr_max, teaching_eligible, pedagogical_priority,
        explanation_en, explanation_fa, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(3), NOW(3))
      `,
      [
        catalog.id,
        catalog.displayNameEn,
        catalog.displayNameFa,
        catalog.category,
        catalog.subcategory,
        catalog.cefrMin,
        catalog.cefrMax,
        catalog.teachingEligible ? 1 : 0,
        catalog.pedagogicalPriority,
        catalog.explanationEn,
        catalog.explanationFa,
        JSON.stringify(catalog.payload),
      ],
    );
    return "catalog";
  }

  // Stubs are analysis placeholders only — never learner-facing by default.
  await db.execute<ResultSetHeader>(
    `
    INSERT INTO grammar_concepts (
      id, display_name_en, teaching_eligible, created_at, updated_at
    ) VALUES (?, ?, 0, NOW(3), NOW(3))
    `,
    [grammarId, grammarId],
  );
  return "stub";
}

export async function upsertGrammarConcepts(
  concepts: GrammarCatalogEntry[],
  db: DbExecutor = getContentSyncPool(),
): Promise<number> {
  let upserted = 0;
  for (const catalog of concepts) {
    await db.execute<ResultSetHeader>(
      `
      INSERT INTO grammar_concepts (
        id, display_name_en, display_name_fa, category, subcategory,
        cefr_min, cefr_max, teaching_eligible, pedagogical_priority,
        explanation_en, explanation_fa, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        display_name_en = VALUES(display_name_en),
        display_name_fa = VALUES(display_name_fa),
        category = VALUES(category),
        subcategory = VALUES(subcategory),
        cefr_min = VALUES(cefr_min),
        cefr_max = VALUES(cefr_max),
        teaching_eligible = VALUES(teaching_eligible),
        pedagogical_priority = VALUES(pedagogical_priority),
        explanation_en = VALUES(explanation_en),
        explanation_fa = VALUES(explanation_fa),
        payload_json = VALUES(payload_json),
        updated_at = NOW(3)
      `,
      [
        catalog.id,
        catalog.displayNameEn,
        catalog.displayNameFa,
        catalog.category,
        catalog.subcategory,
        catalog.cefrMin,
        catalog.cefrMax,
        catalog.teachingEligible ? 1 : 0,
        catalog.pedagogicalPriority,
        catalog.explanationEn,
        catalog.explanationFa,
        JSON.stringify(catalog.payload),
      ],
    );
    upserted += 1;
  }
  return upserted;
}

/**
 * Whether an occurrence may be attached for learner-facing import.
 * Catalog concepts with teachingEligible=false are skipped (defense in depth;
 * the Learn loader also filters teaching_eligible=0).
 * Unknown ids may still be stubbed as non-eligible analysis placeholders.
 */
export function shouldImportGrammarOccurrence(
  grammarId: string,
  catalogById: Map<string, GrammarCatalogEntry>,
): boolean {
  const catalog = catalogById.get(grammarId);
  if (catalog && !catalog.teachingEligible) return false;
  return true;
}

/**
 * Preview/accounting for Grammar occurrence artifacts.
 *
 * Important: file `entries` are one row per canonicalKey (often with an empty
 * `occurrences` array). Learner-facing detections are the nested items.
 * Admin preview historically counted only clip-matched entries — that number
 * (e.g. 784) is NOT the learner-facing occurrence count (e.g. 312).
 */
export type GrammarOccurrenceImportPreview = {
  /** Clip-matched file entries (includes empty `occurrences: []`). */
  grammarOccurrenceEntries: number;
  /** Clip-matched entries that contain ≥1 nested occurrence. */
  grammarOccurrenceEntriesNonEmpty: number;
  /** All nested occurrence items in the uploaded artifact (source baseline). */
  grammarOccurrenceSourceItems: number;
  /** Nested items whose canonicalKey is present in clips. */
  grammarOccurrenceItemsForClips: number;
  /** Rows that would be inserted after eligibility filter + canonical-key fan-out. */
  grammarOccurrencesWouldImport: number;
  /** Nested items skipped because catalog marks teachingEligible=false. */
  grammarOccurrencesSkippedIneligible: number;
  /** Nested grammarIds not present in the catalog (would become stubs). */
  grammarOccurrenceOrphanGrammarIds: string[];
};

export function summarizeGrammarOccurrenceImportPreview(args: {
  entries: GrammarOccurrenceEntry[];
  catalog: GrammarCatalogEntry[];
  clipCanonicalKeys: Set<string>;
  /** Clip multiplicity per canonicalKey (from clips.json), for fan-out preview. */
  partCountByCanonicalKey: Map<string, number>;
}): GrammarOccurrenceImportPreview {
  const catalogById = new Map(args.catalog.map((c) => [c.id, c]));
  const orphanIds = new Set<string>();

  let grammarOccurrenceEntries = 0;
  let grammarOccurrenceEntriesNonEmpty = 0;
  let grammarOccurrenceSourceItems = 0;
  let grammarOccurrenceItemsForClips = 0;
  let grammarOccurrencesWouldImport = 0;
  let grammarOccurrencesSkippedIneligible = 0;

  for (const entry of args.entries) {
    const items = entry.occurrences;
    grammarOccurrenceSourceItems += items.length;

    for (const item of items) {
      if (!catalogById.has(item.grammarId)) {
        orphanIds.add(item.grammarId);
      }
    }

    if (!args.clipCanonicalKeys.has(entry.canonicalKey)) continue;

    grammarOccurrenceEntries += 1;
    if (items.length > 0) grammarOccurrenceEntriesNonEmpty += 1;
    grammarOccurrenceItemsForClips += items.length;

    const fanOut = args.partCountByCanonicalKey.get(entry.canonicalKey) ?? 0;
    if (fanOut === 0) continue;

    for (const item of items) {
      if (!shouldImportGrammarOccurrence(item.grammarId, catalogById)) {
        grammarOccurrencesSkippedIneligible += 1;
        continue;
      }
      grammarOccurrencesWouldImport += fanOut;
    }
  }

  return {
    grammarOccurrenceEntries,
    grammarOccurrenceEntriesNonEmpty,
    grammarOccurrenceSourceItems,
    grammarOccurrenceItemsForClips,
    grammarOccurrencesWouldImport,
    grammarOccurrencesSkippedIneligible,
    grammarOccurrenceOrphanGrammarIds: [...orphanIds].sort(),
  };
}

/**
 * Expand one occurrence artifact entry onto every part sharing its canonicalKey.
 * canonical_key is not unique — duplicate keys must fan out to all matching parts.
 */
export function partIdsForCanonicalKey(
  partsByKey: Map<string, string[]>,
  canonicalKey: string,
): string[] {
  return partsByKey.get(canonicalKey) ?? [];
}

/**
 * Attach grammar occurrences to parts by canonicalKey.
 * Creates stub grammar_concepts (teaching_eligible=0) for ids missing from the catalog.
 * Skips catalog concepts marked teachingEligible=false.
 */
export async function importGrammarOccurrencesForEpisode(
  episodeId: string,
  occurrences: GrammarOccurrenceEntry[],
  catalog: GrammarCatalogEntry[],
  clipCanonicalKeys: Set<string>,
  db: DbExecutor = getContentSyncPool(),
): Promise<ImportGrammarResult> {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const [partRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(id AS CHAR) AS id, canonical_key AS canonicalKey
    FROM parts
    WHERE episode_id = ?
      AND canonical_key IS NOT NULL
      AND retired_at IS NULL
    `,
    [episodeId],
  );

  const partsByKey = new Map<string, string[]>();
  for (const row of partRows) {
    const key = String(row.canonicalKey);
    const list = partsByKey.get(key) ?? [];
    list.push(String(row.id));
    partsByKey.set(key, list);
  }

  let occurrencesImported = 0;
  let stubConceptsCreated = 0;
  const ensured = new Set<string>();

  for (const entry of occurrences) {
    if (!clipCanonicalKeys.has(entry.canonicalKey)) continue;
    const partIds = partIdsForCanonicalKey(partsByKey, entry.canonicalKey);
    if (partIds.length === 0) continue;

    for (const occ of entry.occurrences) {
      if (!shouldImportGrammarOccurrence(occ.grammarId, catalogById)) {
        continue;
      }

      if (!ensured.has(occ.grammarId)) {
        const kind = await ensureGrammarConcept(occ.grammarId, catalogById, db);
        if (kind === "stub") stubConceptsCreated += 1;
        ensured.add(occ.grammarId);
      }

      for (const partId of partIds) {
        await db.execute<ResultSetHeader>(
          `
          INSERT INTO part_grammar_occurrences (
            id, part_id, grammar_id, evidence_span, confidence, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(3))
          `,
          [
            randomUUID(),
            partId,
            occ.grammarId,
            occ.evidenceSpan,
            occ.confidence,
            occ.source,
          ],
        );
        occurrencesImported += 1;
      }
    }
  }

  return {
    conceptsUpserted: ensured.size,
    stubConceptsCreated,
    occurrencesImported,
  };
}
