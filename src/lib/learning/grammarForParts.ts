/**
 * Group part grammar occurrences into UI-ready concept lists.
 * Pure helpers — no DB / network.
 */

export type GrammarOccurrenceInput = {
  occurrenceId: string;
  partId: string;
  partOrder: number;
  partText: string;
  grammarId: string;
  evidenceSpan: string | null;
  confidence: number | null;
  source: string | null;
  displayNameEn: string;
  displayNameFa: string | null;
  explanationEn: string | null;
  explanationFa: string | null;
  category: string | null;
  subcategory: string | null;
  cefrMin: string | null;
  cefrMax: string | null;
  /** Raw catalog payload (formation, usage, examples, …). */
  payload: unknown;
};

export type GrammarLessonOccurrence = {
  occurrenceId: string;
  partId: string;
  partOrder: number;
  /** Full caption / part text from the current learning unit. */
  partText: string;
  evidenceSpan: string | null;
  confidence: number | null;
  source: string | null;
};

export type GrammarCatalogExample = {
  text: string;
  translationFa: string | null;
  type: string | null;
};

export type GrammarConceptGroup = {
  id: string;
  titleEn: string;
  titleFa: string | null;
  explanationEn: string | null;
  explanationFa: string | null;
  formationEn: string | null;
  formationFa: string | null;
  usageEn: string | null;
  usageFa: string | null;
  category: string | null;
  subcategory: string | null;
  cefrMin: string | null;
  cefrMax: string | null;
  /** Generic catalog examples (not lesson-specific). */
  catalogExamples: GrammarCatalogExample[];
  occurrenceCount: number;
  occurrences: GrammarLessonOccurrence[];
};

export type GrammarForPartsResult = {
  grammar: GrammarConceptGroup[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function localizedField(
  container: unknown,
  key: "en" | "fa",
): string | null {
  const row = asRecord(container);
  if (!row) return null;
  return optionalString(row[key]);
}

export function extractGrammarPayloadFields(payload: unknown): {
  formationEn: string | null;
  formationFa: string | null;
  usageEn: string | null;
  usageFa: string | null;
  catalogExamples: GrammarCatalogExample[];
} {
  const root = asRecord(payload);
  if (!root) {
    return {
      formationEn: null,
      formationFa: null,
      usageEn: null,
      usageFa: null,
      catalogExamples: [],
    };
  }

  const examplesRaw = Array.isArray(root.examples) ? root.examples : [];
  const catalogExamples: GrammarCatalogExample[] = [];
  for (const item of examplesRaw) {
    const row = asRecord(item);
    if (!row) continue;
    const text = optionalString(row.text);
    if (!text) continue;
    catalogExamples.push({
      text,
      translationFa: optionalString(row.translationFa),
      type: optionalString(row.type),
    });
  }

  return {
    formationEn: localizedField(root.formation, "en"),
    formationFa: localizedField(root.formation, "fa"),
    usageEn: localizedField(root.usage, "en"),
    usageFa: localizedField(root.usage, "fa"),
    catalogExamples,
  };
}

function parsePayload(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Group occurrence rows by grammar concept id.
 * Duplicate concepts across merged parts collapse into one list item.
 */
export function groupGrammarByConcept(
  rows: GrammarOccurrenceInput[],
): GrammarConceptGroup[] {
  const byId = new Map<string, GrammarConceptGroup>();

  for (const row of rows) {
    let group = byId.get(row.grammarId);
    if (!group) {
      const fields = extractGrammarPayloadFields(parsePayload(row.payload));
      group = {
        id: row.grammarId,
        titleEn: row.displayNameEn || row.grammarId,
        titleFa: row.displayNameFa,
        explanationEn: row.explanationEn,
        explanationFa: row.explanationFa,
        formationEn: fields.formationEn,
        formationFa: fields.formationFa,
        usageEn: fields.usageEn,
        usageFa: fields.usageFa,
        category: row.category,
        subcategory: row.subcategory,
        cefrMin: row.cefrMin,
        cefrMax: row.cefrMax,
        catalogExamples: fields.catalogExamples,
        occurrenceCount: 0,
        occurrences: [],
      };
      byId.set(row.grammarId, group);
    }

    group.occurrences.push({
      occurrenceId: row.occurrenceId,
      partId: row.partId,
      partOrder: row.partOrder,
      partText: row.partText,
      evidenceSpan: row.evidenceSpan,
      confidence: row.confidence,
      source: row.source,
    });
    group.occurrenceCount = group.occurrences.length;
  }

  const groups = [...byId.values()];
  groups.sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    return a.titleEn.localeCompare(b.titleEn);
  });

  for (const group of groups) {
    group.occurrences.sort((a, b) => {
      if (a.partOrder !== b.partOrder) return a.partOrder - b.partOrder;
      return a.occurrenceId.localeCompare(b.occurrenceId);
    });
  }

  return groups;
}

export function uniquePartIds(partIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of partIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
