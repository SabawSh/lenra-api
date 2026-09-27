import {
  groupGrammarByConcept,
  uniquePartIds,
  type GrammarForPartsResult,
  type GrammarOccurrenceInput,
} from "@/lib/learning/grammarForParts";
import type { RowDataPacket } from "mysql2/promise";

export const MAX_PART_IDS = 24;

/** Minimal executor shared by Next pool and CLI sync pool. */
export type GrammarDbExecutor = {
  execute: <T extends RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ) => Promise<[T, unknown]>;
};

/**
 * Load learner-facing grammar concepts + occurrences for the given part IDs.
 * Catalog policy is enforced here: only `grammar_concepts.teaching_eligible = 1`.
 * Does not scan the full grammar catalog.
 */
export async function loadGrammarForPartIds(
  partIds: string[],
  db: GrammarDbExecutor,
): Promise<GrammarForPartsResult> {
  const ids = uniquePartIds(partIds).slice(0, MAX_PART_IDS);
  if (ids.length === 0) {
    return { grammar: [] };
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT
      CAST(pgo.id AS CHAR) AS occurrenceId,
      CAST(pgo.part_id AS CHAR) AS partId,
      p.\`order\` AS partOrder,
      p.text AS partText,
      pgo.grammar_id AS grammarId,
      pgo.evidence_span AS evidenceSpan,
      pgo.confidence AS confidence,
      pgo.source AS source,
      gc.display_name_en AS displayNameEn,
      gc.display_name_fa AS displayNameFa,
      gc.explanation_en AS explanationEn,
      gc.explanation_fa AS explanationFa,
      gc.category AS category,
      gc.subcategory AS subcategory,
      gc.cefr_min AS cefrMin,
      gc.cefr_max AS cefrMax,
      gc.payload_json AS payload
    FROM part_grammar_occurrences pgo
    INNER JOIN parts p ON p.id = pgo.part_id
    INNER JOIN grammar_concepts gc ON gc.id = pgo.grammar_id
    WHERE pgo.part_id IN (${placeholders})
      AND gc.teaching_eligible = 1
    ORDER BY p.\`order\` ASC, pgo.created_at ASC
    `,
    ids,
  );

  const inputs: GrammarOccurrenceInput[] = rows.map((r) => ({
    occurrenceId: String(r.occurrenceId),
    partId: String(r.partId),
    partOrder: Number(r.partOrder ?? 0),
    partText: String(r.partText ?? ""),
    grammarId: String(r.grammarId),
    evidenceSpan: r.evidenceSpan ? String(r.evidenceSpan) : null,
    confidence:
      r.confidence != null && Number.isFinite(Number(r.confidence))
        ? Number(r.confidence)
        : null,
    source: r.source ? String(r.source) : null,
    displayNameEn: String(r.displayNameEn ?? r.grammarId),
    displayNameFa: r.displayNameFa ? String(r.displayNameFa) : null,
    explanationEn: r.explanationEn ? String(r.explanationEn) : null,
    explanationFa: r.explanationFa ? String(r.explanationFa) : null,
    category: r.category ? String(r.category) : null,
    subcategory: r.subcategory ? String(r.subcategory) : null,
    cefrMin: r.cefrMin ? String(r.cefrMin) : null,
    cefrMax: r.cefrMax ? String(r.cefrMax) : null,
    payload: r.payload,
  }));

  return { grammar: groupGrammarByConcept(inputs) };
}
