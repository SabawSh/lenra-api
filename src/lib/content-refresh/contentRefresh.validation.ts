/**
 * Lightweight schema/loader checks for content refresh (no DB).
 *   npm run test:content-refresh
 */
import { resolve } from "path";
import { loadPipelineClipsFromFile } from "../content-sync/loadPipelineClips";
import { summarizeGrammarOccurrenceImportPreview } from "./importGrammar";
import {
  loadGrammarCatalogFile,
  loadGrammarOccurrencesFile,
  loadLearningAnalysisVocabulary,
  loadTranslationsFile,
  loadVocabularyOccurrencesFile,
  loadVocabularySensesFile,
  mergeVocabularyOccurrences,
} from "./loadArtifacts";

const pipelineOut = resolve(
  process.cwd(),
  "../lenra-content-pipeline/output",
);
const grammarCatalog = resolve(
  process.cwd(),
  "../lenra-content-pipeline/data/grammar.json",
);

/** Authoritative Grammar V1 learner-facing occurrence baseline. */
const LEARNER_FACING_OCCURRENCE_BASELINE = 312;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const clips = loadPipelineClipsFromFile(resolve(pipelineOut, "clips.json"));
assert(clips.clips.length === 794, `expected 794 clips, got ${clips.clips.length}`);
assert(
  clips.clips.every((c) => c.canonicalKey && c.order >= 1),
  "clips missing key/order",
);

const translations = loadTranslationsFile(
  resolve(pipelineOut, "translations.json"),
);
assert(translations.length === 784, `expected 784 translations`);

const senses = loadVocabularySensesFile(
  resolve(pipelineOut, "vocabulary-senses.json"),
);
assert(senses.length === 626, `expected 626 senses, got ${senses.length}`);

const fileVocab = loadVocabularyOccurrencesFile(
  resolve(pipelineOut, "vocabulary-occurrences.json"),
);
const learningVocab = loadLearningAnalysisVocabulary(
  resolve(pipelineOut, "learning-analysis.json"),
);
const merged = mergeVocabularyOccurrences(learningVocab, fileVocab);
assert(merged.length >= 1, "expected some merged vocab entries");

const grammar = loadGrammarCatalogFile(grammarCatalog);
assert(grammar.length === 48, `expected 48 grammar concepts`);
const eligible = grammar.filter((c) => c.teachingEligible);
assert(
  eligible.length === 31,
  `expected 31 teachingEligible concepts, got ${eligible.length}`,
);
assert(
  grammar.some((c) => c.id === "subordinate_clause" && !c.teachingEligible),
  "subordinate_clause must be demoted (teachingEligible=false)",
);

const grammarOcc = loadGrammarOccurrencesFile(
  resolve(pipelineOut, "grammar-occurrences.json"),
);
assert(grammarOcc.length > 0, "expected grammar occurrences");

const eligibleIds = new Set(eligible.map((c) => c.id));
let occurrenceCount = 0;
for (const entry of grammarOcc) {
  for (const occ of entry.occurrences) {
    occurrenceCount += 1;
    assert(
      eligibleIds.has(occ.grammarId),
      `learner-facing artifact references non-eligible grammarId: ${occ.grammarId}`,
    );
  }
}
assert(
  occurrenceCount === LEARNER_FACING_OCCURRENCE_BASELINE,
  `expected ${LEARNER_FACING_OCCURRENCE_BASELINE} learner-facing occurrences, got ${occurrenceCount}`,
);

const clipKeys = new Set(clips.clips.map((c) => c.canonicalKey));
for (const t of translations) {
  assert(clipKeys.has(t.canonicalKey), `translation key missing from clips: ${t.canonicalKey}`);
}

const partCountByCanonicalKey = new Map<string, number>();
for (const clip of clips.clips) {
  partCountByCanonicalKey.set(
    clip.canonicalKey,
    (partCountByCanonicalKey.get(clip.canonicalKey) ?? 0) + 1,
  );
}

const grammarPreview = summarizeGrammarOccurrenceImportPreview({
  entries: grammarOcc,
  catalog: grammar,
  clipCanonicalKeys: clipKeys,
  partCountByCanonicalKey,
});

// Discrepancy regression: entry count ≠ nested learner-facing detections.
assert(
  grammarPreview.grammarOccurrenceEntries === 784,
  `expected 784 clip-matched grammar file entries, got ${grammarPreview.grammarOccurrenceEntries}`,
);
assert(
  grammarPreview.grammarOccurrenceSourceItems ===
    LEARNER_FACING_OCCURRENCE_BASELINE,
  `source items must equal baseline ${LEARNER_FACING_OCCURRENCE_BASELINE}, got ${grammarPreview.grammarOccurrenceSourceItems}`,
);
assert(
  grammarPreview.grammarOccurrenceEntries >
    grammarPreview.grammarOccurrenceSourceItems,
  "entry count must exceed nested items when empty arrays pad the file",
);
assert(
  grammarPreview.grammarOccurrenceEntriesNonEmpty <
    grammarPreview.grammarOccurrenceEntries,
  "many clip-matched entries are empty and must not be counted as detections",
);
assert(
  grammarPreview.grammarOccurrenceItemsForClips === 309,
  `expected 309 clip-matched nested items, got ${grammarPreview.grammarOccurrenceItemsForClips}`,
);
assert(
  grammarPreview.grammarOccurrencesWouldImport === 311,
  `expected 311 importable rows after fan-out, got ${grammarPreview.grammarOccurrencesWouldImport}`,
);
assert(
  grammarPreview.grammarOccurrencesSkippedIneligible === 0,
  "current artifact must not reference demoted concepts",
);
assert(
  grammarPreview.grammarOccurrenceOrphanGrammarIds.length === 0,
  `unexpected orphan grammar ids: ${grammarPreview.grammarOccurrenceOrphanGrammarIds.join(", ")}`,
);

// Fan-out: duplicate clip keys must increase import rows above clip-matched items.
assert(
  grammarPreview.grammarOccurrencesWouldImport >
    grammarPreview.grammarOccurrenceItemsForClips,
  "duplicate canonical-key fan-out must add rows beyond clip-matched items",
);

console.log("contentRefresh: ok", {
  clips: clips.clips.length,
  translations: translations.length,
  senses: senses.length,
  learningVocabUnits: learningVocab.length,
  grammarConcepts: grammar.length,
  grammarTeachingEligible: eligible.length,
  grammarOccurrenceEntries: grammarPreview.grammarOccurrenceEntries,
  grammarOccurrenceSourceItems: grammarPreview.grammarOccurrenceSourceItems,
  grammarOccurrenceItemsForClips: grammarPreview.grammarOccurrenceItemsForClips,
  grammarOccurrencesWouldImport: grammarPreview.grammarOccurrencesWouldImport,
});
