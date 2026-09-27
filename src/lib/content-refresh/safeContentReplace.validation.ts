/**
 * Progress-preserving content replace contracts (no DB mutations).
 *
 *   npm run test:safe-content-replace
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { buildContentSyncPlan } from "../content-sync/buildContentSyncPlan";
import { loadPipelineClipsFromFile } from "../content-sync/loadPipelineClips";
import type { ExistingSyncPart, PipelineClip } from "../content-sync/types";
import { summarizeGrammarOccurrenceImportPreview } from "./importGrammar";
import {
  loadGrammarCatalogFile,
  loadGrammarOccurrencesFile,
} from "./loadArtifacts";
import {
  PARTS_ID_TABLE_CLASSIFICATION,
  planSafeContentReplace,
} from "./safeContentReplace";

function clip(
  overrides: Partial<PipelineClip> & {
    order: number;
    canonicalKey: string;
    text?: string;
  },
): PipelineClip {
  return {
    pipelineId: overrides.pipelineId ?? `pipe-${overrides.order}`,
    order: overrides.order,
    canonicalKey: overrides.canonicalKey,
    text: overrides.text ?? "Hello",
    startMs: overrides.startMs ?? overrides.order * 1000,
    endMs: overrides.endMs ?? overrides.order * 1000 + 500,
    durationMs: overrides.durationMs ?? 500,
    speechStartMs: overrides.speechStartMs ?? null,
    speechEndMs: overrides.speechEndMs ?? null,
    speechDurationMs: overrides.speechDurationMs ?? null,
    level: overrides.level ?? "easy",
    difficultyScore: overrides.difficultyScore ?? 10,
    tokens: overrides.tokens ?? [{ value: "hi", lemma: "hi", type: "word" }],
    metrics:
      overrides.metrics ?? { wordCount: 1, speechRate: 1, sentenceCount: 1 },
    sourceCues: overrides.sourceCues ?? null,
    sourceCueIndexes: overrides.sourceCueIndexes ?? null,
    hls: overrides.hls ?? null,
    encodeStartMs: overrides.encodeStartMs ?? null,
    encodeEndMs: overrides.encodeEndMs ?? null,
  };
}

function part(
  overrides: Partial<ExistingSyncPart> & {
    id: string;
    order: number;
    canonicalKey: string | null;
  },
): ExistingSyncPart {
  return {
    id: overrides.id,
    episodeId: overrides.episodeId ?? "ep-1",
    order: overrides.order,
    canonicalKey: overrides.canonicalKey,
    text: overrides.text ?? "Hello",
    retiredAt: overrides.retiredAt ?? null,
    playbackStartMs: overrides.playbackStartMs ?? 0,
    playbackEndMs: overrides.playbackEndMs ?? 1000,
    playbackDurationMs: overrides.playbackDurationMs ?? 1000,
    speechStartMs: overrides.speechStartMs ?? 0,
    speechEndMs: overrides.speechEndMs ?? 1000,
    speechDurationMs: overrides.speechDurationMs ?? 1000,
    difficulty: overrides.difficulty ?? "easy",
    difficultyScore: overrides.difficultyScore ?? 1,
    wordCount: overrides.wordCount ?? 1,
    speechRate: overrides.speechRate ?? null,
    tokensJson: overrides.tokensJson ?? JSON.stringify([{ value: "Hello" }]),
  };
}

// 1) Existing part keeps the same UUID after refresh plan
{
  const plan = planSafeContentReplace({
    episodeId: "ep-1",
    pipelineClips: [clip({ order: 1, canonicalKey: "KEY_A", text: "Updated" })],
    existingParts: [part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A" })],
  });
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0]!.partId, "uuid-a");
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.retires.length, 0);
}

// 2–5) Progress / tokens / saved cards survive because id is preserved
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_part_progress,
  "PRESERVE_BY_PART_ID",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_token_marks,
  "PRESERVE_BY_PART_ID",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.saved_vocabulary_cards,
  "PRESERVE_BY_PART_ID",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_reminders,
  "PRESERVE_BY_PART_ID",
);

// 6–7) Content attachments are rebuild-class
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.part_grammar_occurrences,
  "DELETE_AND_REBUILD",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.part_vocabulary_occurrences,
  "DELETE_AND_REBUILD",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.caption_translations,
  "DELETE_AND_REBUILD",
);

// 8) New canonicalKeys get new inserts (new UUIDs at apply time)
{
  const plan = planSafeContentReplace({
    episodeId: "ep-1",
    pipelineClips: [
      clip({ order: 1, canonicalKey: "KEY_A" }),
      clip({ order: 2, canonicalKey: "KEY_NEW" }),
    ],
    existingParts: [part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A" })],
  });
  assert.equal(plan.matches[0]!.partId, "uuid-a");
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0]!.canonicalKey, "KEY_NEW");
}

// 9) Removed keys are soft-retired (not hard-deleted)
{
  const plan = planSafeContentReplace({
    episodeId: "ep-1",
    pipelineClips: [clip({ order: 1, canonicalKey: "KEY_A" })],
    existingParts: [
      part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A" }),
      part({ id: "uuid-gone", order: 2, canonicalKey: "KEY_GONE" }),
    ],
  });
  assert.equal(plan.retires.length, 1);
  assert.equal(plan.retires[0]!.partId, "uuid-gone");
  assert.equal(plan.retires[0]!.canonicalKey, "KEY_GONE");
}

// 10–11) Resume / Adaptive Teacher must not be deleted by replace
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_learning_resume,
  "MUST_NOT_BE_DELETED",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.adaptive_teacher_events,
  "MUST_NOT_BE_DELETED",
);
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_adaptive_skill_sections,
  "MUST_NOT_BE_DELETED",
);

// 12) Dry-run plans are marked and unambiguous when pairing is clean
{
  const plan = buildContentSyncPlan({
    episodeId: "ep-1",
    pipelineClips: [clip({ order: 1, canonicalKey: "A" })],
    existingParts: [part({ id: "u1", order: 1, canonicalKey: "A" })],
    dryRun: true,
  });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.ambiguousMatches.length, 0);
}

// 13) Learner progress classification stays PRESERVE_BY_PART_ID
assert.equal(
  PARTS_ID_TABLE_CLASSIFICATION.user_part_progress,
  "PRESERVE_BY_PART_ID",
);

// Live Coraline artifact contract: full key overlap → all preserved, 0 retires
{
  const pipelineOut = resolve(
    process.cwd(),
    "../lenra-content-pipeline/output",
  );
  const clips = loadPipelineClipsFromFile(resolve(pipelineOut, "clips.json"));
  const existingParts: ExistingSyncPart[] = clips.clips.map((c, i) =>
    part({
      id: `preserved-${i + 1}`,
      order: c.order,
      canonicalKey: c.canonicalKey,
      text: c.text,
    }),
  );
  const plan = planSafeContentReplace({
    episodeId: "coraline",
    pipelineClips: clips.clips,
    existingParts,
  });
  assert.equal(plan.matches.length, clips.clips.length);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.retires.length, 0);
  const matchedIds = new Set(plan.matches.map((m) => m.partId));
  for (const existing of existingParts) {
    assert.ok(
      matchedIds.has(existing.id),
      `expected existing part ${existing.id} to be preserved`,
    );
  }
  assert.equal(matchedIds.size, clips.clips.length);

  const grammar = loadGrammarCatalogFile(
    resolve(process.cwd(), "../lenra-content-pipeline/data/grammar.json"),
  );
  const grammarOcc = loadGrammarOccurrencesFile(
    resolve(pipelineOut, "grammar-occurrences.json"),
  );
  const clipKeySet = new Set(clips.clips.map((c) => c.canonicalKey));
  const partCountByCanonicalKey = new Map<string, number>();
  for (const c of clips.clips) {
    partCountByCanonicalKey.set(
      c.canonicalKey,
      (partCountByCanonicalKey.get(c.canonicalKey) ?? 0) + 1,
    );
  }
  const gPreview = summarizeGrammarOccurrenceImportPreview({
    entries: grammarOcc,
    catalog: grammar,
    clipCanonicalKeys: clipKeySet,
    partCountByCanonicalKey,
  });
  assert.equal(gPreview.grammarOccurrenceSourceItems, 312);
  assert.equal(gPreview.grammarOccurrencesWouldImport, 311);
}

console.log("safeContentReplace.validation: ok", {
  classificationTables: Object.keys(PARTS_ID_TABLE_CLASSIFICATION).length,
  coralinePreserveAll: true,
});
