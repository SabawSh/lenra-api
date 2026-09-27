/**
 * Stage 9 — Vocabulary learner regression (logic-level; no browser harness).
 *   npm run test:vocabulary-learner-regression
 */
import { resolve } from "path";
import { loadPipelineClipsFromFile } from "../content-sync/loadPipelineClips";
import {
  loadLearningAnalysisVocabulary,
  loadVocabularyOccurrencesFile,
  loadVocabularySensesFile,
  mergeVocabularyOccurrences,
} from "../content-refresh/loadArtifacts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const pipelineOut = resolve(
  process.cwd(),
  "../lenra-content-pipeline/output",
);

const clips = loadPipelineClipsFromFile(resolve(pipelineOut, "clips.json"));
const senses = loadVocabularySensesFile(
  resolve(pipelineOut, "vocabulary-senses.json"),
);
const fileVocab = loadVocabularyOccurrencesFile(
  resolve(pipelineOut, "vocabulary-occurrences.json"),
);
const learningVocab = loadLearningAnalysisVocabulary(
  resolve(pipelineOut, "learning-analysis.json"),
);
const merged = mergeVocabularyOccurrences(learningVocab, fileVocab);

const senseIds = new Set(senses.map((s) => s.senseId));
const clipKeys = new Set(clips.clips.map((c) => c.canonicalKey));

let assignments = 0;
let orphanSense = 0;
let orphanKey = 0;
let invalidEvidence = 0;
const keyCounts = new Map<string, number>();
for (const c of clips.clips) {
  keyCounts.set(c.canonicalKey, (keyCounts.get(c.canonicalKey) || 0) + 1);
}
const dupGroups = [...keyCounts.values()].filter((n) => n > 1).length;

const clipText = new Map(clips.clips.map((c) => [c.canonicalKey, c.text]));

for (const entry of merged) {
  if (!clipKeys.has(entry.canonicalKey)) {
    orphanKey += 1;
    continue;
  }
  const text = clipText.get(entry.canonicalKey) || "";
  for (const occ of entry.occurrences) {
    assignments += 1;
    if (!senseIds.has(occ.senseId)) orphanSense += 1;
    if (occ.evidenceSpan && text && !text.includes(occ.evidenceSpan)) {
      invalidEvidence += 1;
    }
  }
}

assert(orphanSense === 0, `orphan vocabulary sense refs: ${orphanSense}`);
assert(orphanKey === 0, `orphan vocabulary canonicalKeys: ${orphanKey}`);
assert(invalidEvidence === 0, `invalid vocabulary evidence: ${invalidEvidence}`);
assert(dupGroups === 7, `expected 7 duplicate canonicalKey groups, got ${dupGroups}`);
assert(assignments > 0, "expected vocabulary assignments");

// Duplicate-key fan-out contract: one occurrence entry key may map to N clips/parts.
const multi = [...keyCounts.entries()].find(([, n]) => n > 1);
assert(multi, "expected at least one duplicate canonicalKey group");
const [dupKey, fanOut] = multi!;
const occForDup = merged.find((e) => e.canonicalKey === dupKey);
assert(occForDup, `missing vocabulary entry for duplicate key ${dupKey}`);
assert(
  fanOut >= 2,
  `duplicate key ${dupKey} should fan out to ≥2 parts (got ${fanOut})`,
);

// Unit isolation contract (logic): distinct keys must not share the same entry object identity.
const byKey = new Map(merged.map((e) => [e.canonicalKey, e]));
const keys = [...byKey.keys()].slice(0, 3);
if (keys.length >= 2) {
  assert(
    byKey.get(keys[0]!) !== byKey.get(keys[1]!),
    "vocabulary entries for different keys must be distinct",
  );
}

console.log("vocabularyLearnerRegression: ok", {
  browserE2E: "unavailable",
  senses: senses.length,
  occurrenceEntries: fileVocab.length,
  mergedAssignments: assignments,
  duplicateCanonicalKeyGroups: dupGroups,
  orphanSense,
  orphanKey,
  invalidEvidence,
  fanOutExample: { canonicalKey: dupKey, parts: fanOut },
});
