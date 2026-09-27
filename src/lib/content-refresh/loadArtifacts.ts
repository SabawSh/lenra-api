import { readFileSync } from "fs";
import type {
  GrammarCatalogEntry,
  GrammarOccurrenceEntry,
  GrammarOccurrenceItem,
  TranslationEntry,
  VocabularyOccurrenceEntry,
  VocabularyOccurrenceItem,
  VocabularySenseEntry,
} from "./types";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: expected object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected array`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseTranslationsDocument(raw: unknown): TranslationEntry[] {
  const doc = asRecord(raw, "translations.json");
  const entries = asArray(doc.entries, "translations.json.entries");
  const out: TranslationEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = asRecord(entries[i], `translations.json.entries[${i}]`);
    const canonicalKey = optionalString(row.canonicalKey);
    const translation = optionalString(row.translation);
    if (!canonicalKey) {
      throw new Error(`translations.json.entries[${i}] missing canonicalKey`);
    }
    if (!translation) {
      throw new Error(`translations.json.entries[${i}] missing translation`);
    }
    out.push({
      canonicalKey,
      sourceText: String(row.sourceText ?? ""),
      translation,
      provider: optionalString(row.provider),
      providerModel: optionalString(row.providerModel),
      translatedAt: optionalString(row.translatedAt),
    });
  }
  return out;
}

export function loadTranslationsFile(path: string): TranslationEntry[] {
  return parseTranslationsDocument(readJson(path));
}

export function parseVocabularySensesDocument(raw: unknown): VocabularySenseEntry[] {
  const doc = asRecord(raw, "vocabulary-senses.json");
  const entries = asArray(doc.entries, "vocabulary-senses.json.entries");
  const out: VocabularySenseEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = asRecord(entries[i], `vocabulary-senses.json.entries[${i}]`);
    const senseId = optionalString(row.senseId);
    const lemma = optionalString(row.lemma);
    if (!senseId) {
      throw new Error(`vocabulary-senses.json.entries[${i}] missing senseId`);
    }
    if (!lemma) {
      throw new Error(`vocabulary-senses.json.entries[${i}] missing lemma`);
    }
    if (senseId.length > 64) {
      throw new Error(
        `vocabulary-senses.json.entries[${i}] senseId longer than 64 chars: ${senseId}`,
      );
    }
    const kindRaw = String(row.kind ?? "word").toLowerCase();
    const kind = kindRaw === "phrase" ? "phrase" : "word";
    out.push({
      senseId,
      lemma,
      kind,
      partOfSpeech: optionalString(row.partOfSpeech),
      meaningFa: String(row.meaningFa ?? ""),
      meaningEn: String(row.meaningEn ?? ""),
      exampleSentence: optionalString(row.exampleSentence),
      exampleTranslation: optionalString(row.exampleTranslation),
      cefr: optionalString(row.cefr),
      difficultyScore: optionalNumber(row.difficultyScore),
      reviewStatus: optionalString(row.reviewStatus),
    });
  }
  return out;
}

function parseOccurrenceItem(
  raw: unknown,
  label: string,
): VocabularyOccurrenceItem {
  const row = asRecord(raw, label);
  const senseId = optionalString(row.senseId);
  if (!senseId) throw new Error(`${label} missing senseId`);
  return {
    senseId,
    surface: optionalString(row.surface),
    lemma: optionalString(row.lemma),
    kind: optionalString(row.kind),
    evidenceSpan: optionalString(row.evidenceSpan),
    confidence: optionalNumber(row.confidence),
  };
}

export function loadVocabularySensesFile(path: string): VocabularySenseEntry[] {
  return parseVocabularySensesDocument(readJson(path));
}

export function parseVocabularyOccurrencesDocument(
  raw: unknown,
): VocabularyOccurrenceEntry[] {
  const doc = asRecord(raw, "vocabulary-occurrences.json");
  const entries = asArray(doc.entries, "vocabulary-occurrences.json.entries");
  const out: VocabularyOccurrenceEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = asRecord(entries[i], `vocabulary-occurrences.json.entries[${i}]`);
    const canonicalKey = optionalString(row.canonicalKey);
    if (!canonicalKey) {
      throw new Error(
        `vocabulary-occurrences.json.entries[${i}] missing canonicalKey`,
      );
    }
    const occurrencesRaw = asArray(
      row.occurrences ?? [],
      `vocabulary-occurrences.json.entries[${i}].occurrences`,
    );
    out.push({
      canonicalKey,
      occurrences: occurrencesRaw.map((item, j) =>
        parseOccurrenceItem(
          item,
          `vocabulary-occurrences.json.entries[${i}].occurrences[${j}]`,
        ),
      ),
    });
  }
  return out;
}

/**
 * Extract vocabulary assignments from learning-analysis.json units.
 * Current Coraline artifact is sparse; still the preferred merged per-clip source.
 */
export function loadVocabularyOccurrencesFile(
  path: string,
): VocabularyOccurrenceEntry[] {
  return parseVocabularyOccurrencesDocument(readJson(path));
}

export function parseLearningAnalysisVocabulary(
  raw: unknown,
): VocabularyOccurrenceEntry[] {
  const doc = asRecord(raw, "learning-analysis.json");
  const units = asArray(doc.units, "learning-analysis.json.units");
  const out: VocabularyOccurrenceEntry[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = asRecord(units[i], `learning-analysis.json.units[${i}]`);
    const canonicalKey = optionalString(unit.canonicalKey);
    if (!canonicalKey) {
      throw new Error(`learning-analysis.json.units[${i}] missing canonicalKey`);
    }
    const analysis = asRecord(
      unit.analysis ?? {},
      `learning-analysis.json.units[${i}].analysis`,
    );
    const vocabulary = asRecord(
      analysis.vocabulary ?? {},
      `learning-analysis.json.units[${i}].analysis.vocabulary`,
    );
    const items = asArray(
      vocabulary.items ?? [],
      `learning-analysis.json.units[${i}].analysis.vocabulary.items`,
    );
    if (items.length === 0) continue;
    out.push({
      canonicalKey,
      occurrences: items.map((item, j) =>
        parseOccurrenceItem(
          item,
          `learning-analysis.json.units[${i}].analysis.vocabulary.items[${j}]`,
        ),
      ),
    });
  }
  return out;
}

export function loadLearningAnalysisVocabulary(
  path: string,
): VocabularyOccurrenceEntry[] {
  return parseLearningAnalysisVocabulary(readJson(path));
}

export function parseGrammarCatalogDocument(raw: unknown): GrammarCatalogEntry[] {
  const doc = asRecord(raw, "grammar.json");
  const entries = asArray(doc.entries, "grammar.json.entries");
  const out: GrammarCatalogEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = asRecord(entries[i], `grammar.json.entries[${i}]`);
    const id = optionalString(row.id);
    if (!id) throw new Error(`grammar.json.entries[${i}] missing id`);
    const displayName = asRecord(
      row.displayName ?? {},
      `grammar.json.entries[${i}].displayName`,
    );
    const cefr = asRecord(row.cefr ?? {}, `grammar.json.entries[${i}].cefr`);
    const explanation = asRecord(
      row.explanation ?? {},
      `grammar.json.entries[${i}].explanation`,
    );
    out.push({
      id,
      displayNameEn: String(displayName.en ?? id),
      displayNameFa: optionalString(displayName.fa),
      category: optionalString(row.category),
      subcategory: optionalString(row.subcategory),
      cefrMin: optionalString(cefr.min),
      cefrMax: optionalString(cefr.max),
      teachingEligible: row.teachingEligible !== false,
      pedagogicalPriority: optionalNumber(row.pedagogicalPriority),
      explanationEn: optionalString(explanation.en),
      explanationFa: optionalString(explanation.fa),
      payload: row,
    });
  }
  return out;
}

function parseGrammarOccurrenceItem(
  raw: unknown,
  label: string,
): GrammarOccurrenceItem {
  const row = asRecord(raw, label);
  const grammarId = optionalString(row.grammarId);
  if (!grammarId) throw new Error(`${label} missing grammarId`);
  return {
    grammarId,
    evidenceSpan: optionalString(row.evidenceSpan),
    confidence: optionalNumber(row.confidence),
    source: optionalString(row.source),
  };
}

export function loadGrammarCatalogFile(path: string): GrammarCatalogEntry[] {
  return parseGrammarCatalogDocument(readJson(path));
}

export function parseGrammarOccurrencesDocument(
  raw: unknown,
): GrammarOccurrenceEntry[] {
  const doc = asRecord(raw, "grammar-occurrences.json");
  const entries = asArray(doc.entries, "grammar-occurrences.json.entries");
  const out: GrammarOccurrenceEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const row = asRecord(entries[i], `grammar-occurrences.json.entries[${i}]`);
    const canonicalKey = optionalString(row.canonicalKey);
    if (!canonicalKey) {
      throw new Error(
        `grammar-occurrences.json.entries[${i}] missing canonicalKey`,
      );
    }
    const occurrencesRaw = asArray(
      row.occurrences ?? [],
      `grammar-occurrences.json.entries[${i}].occurrences`,
    );
    out.push({
      canonicalKey,
      sourceText: optionalString(row.sourceText),
      occurrences: occurrencesRaw.map((item, j) =>
        parseGrammarOccurrenceItem(
          item,
          `grammar-occurrences.json.entries[${i}].occurrences[${j}]`,
        ),
      ),
    });
  }
  return out;
}

export function loadGrammarOccurrencesFile(
  path: string,
): GrammarOccurrenceEntry[] {
  return parseGrammarOccurrencesDocument(readJson(path));
}

/** Merge occurrence lists by canonicalKey (later sources append). */
export function mergeVocabularyOccurrences(
  ...sources: VocabularyOccurrenceEntry[][]
): VocabularyOccurrenceEntry[] {
  const map = new Map<string, VocabularyOccurrenceItem[]>();
  for (const source of sources) {
    for (const entry of source) {
      const existing = map.get(entry.canonicalKey) ?? [];
      const seen = new Set(
        existing.map(
          (o) => `${o.senseId}::${o.evidenceSpan ?? ""}::${o.surface ?? ""}`,
        ),
      );
      for (const occ of entry.occurrences) {
        const key = `${occ.senseId}::${occ.evidenceSpan ?? ""}::${occ.surface ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        existing.push(occ);
      }
      map.set(entry.canonicalKey, existing);
    }
  }
  return [...map.entries()].map(([canonicalKey, occurrences]) => ({
    canonicalKey,
    occurrences,
  }));
}
