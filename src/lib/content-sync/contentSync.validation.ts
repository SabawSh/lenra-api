/**
 * Phase 2 content sync reconciliation tests (pure — no MySQL).
 *
 *   npm run test:content-sync
 */
import { buildContentSyncPlan } from "./buildContentSyncPlan";
import { parsePipelineClipsDocument } from "./loadPipelineClips";
import type { ExistingSyncPart, PipelineClip } from "./types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function clip(
  overrides: Partial<PipelineClip> & {
    order: number;
    canonicalKey: string;
    text: string;
  },
): PipelineClip {
  return {
    pipelineId: overrides.pipelineId ?? `pipe-${overrides.order}`,
    order: overrides.order,
    canonicalKey: overrides.canonicalKey,
    text: overrides.text,
    startMs: overrides.startMs ?? overrides.order * 1000,
    endMs: overrides.endMs ?? overrides.order * 1000 + 500,
    durationMs: overrides.durationMs ?? 500,
    speechStartMs: overrides.speechStartMs ?? null,
    speechEndMs: overrides.speechEndMs ?? null,
    speechDurationMs: overrides.speechDurationMs ?? null,
    level: overrides.level ?? "easy",
    difficultyScore: overrides.difficultyScore ?? 10,
    tokens: overrides.tokens ?? [{ value: "hi", lemma: "hi", type: "word" }],
    metrics: overrides.metrics ?? { wordCount: 1, speechRate: 1, sentenceCount: 1 },
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
  },
): ExistingSyncPart {
  return {
    id: overrides.id,
    episodeId: overrides.episodeId ?? "ep1",
    order: overrides.order,
    canonicalKey: overrides.canonicalKey ?? null,
    text: overrides.text ?? `text-${overrides.order}`,
    retiredAt: overrides.retiredAt ?? null,
    playbackStartMs: overrides.playbackStartMs ?? overrides.order * 1000,
    playbackEndMs: overrides.playbackEndMs ?? overrides.order * 1000 + 500,
    playbackDurationMs: overrides.playbackDurationMs ?? 500,
    speechStartMs: overrides.speechStartMs ?? null,
    speechEndMs: overrides.speechEndMs ?? null,
    speechDurationMs: overrides.speechDurationMs ?? null,
    difficulty: overrides.difficulty ?? "easy",
    difficultyScore: overrides.difficultyScore ?? 10,
    wordCount: overrides.wordCount ?? 1,
    speechRate: overrides.speechRate ?? 1,
    tokensJson:
      overrides.tokensJson ??
      JSON.stringify([{ value: "hi", lemma: "hi", type: "word" }]),
  };
}

{
  // Existing clip — same canonicalKey preserves parts.id
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [clip({ order: 1, canonicalKey: "KEY_A", text: "Hello" })],
    existingParts: [
      part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A", text: "Hello" }),
    ],
  });
  assert(plan.matches.length === 1, "one match");
  assert(plan.matches[0]!.partId === "uuid-a", "preserves parts.id");
  assert(plan.inserts.length === 0, "no insert");
  assert(plan.retires.length === 0, "no retire");
}

{
  // Reordered clip — same key, different order → same id, orderChanged
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [
      clip({ order: 1, canonicalKey: "KEY_A", text: "A" }),
      clip({ order: 2, canonicalKey: "KEY_B", text: "B" }),
    ],
    existingParts: [
      part({ id: "uuid-a", order: 2, canonicalKey: "KEY_A", text: "A" }),
      part({ id: "uuid-b", order: 1, canonicalKey: "KEY_B", text: "B" }),
    ],
  });
  assert(plan.matches.length === 2, "both matched");
  const byKey = new Map(plan.matches.map((m) => [m.canonicalKey, m]));
  assert(byKey.get("KEY_A")!.partId === "uuid-a", "A keeps id");
  assert(byKey.get("KEY_A")!.pipelineOrder === 1, "A moves to order 1");
  assert(byKey.get("KEY_A")!.orderChanged === true, "A marked reordered");
  assert(byKey.get("KEY_B")!.partId === "uuid-b", "B keeps id");
  assert(plan.inserts.length === 0 && plan.retires.length === 0, "no churn");
}

{
  // New clip
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [
      clip({ order: 1, canonicalKey: "KEY_A", text: "A" }),
      clip({ order: 2, canonicalKey: "KEY_NEW", text: "New" }),
    ],
    existingParts: [
      part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A", text: "A" }),
    ],
  });
  assert(plan.inserts.length === 1, "one insert");
  assert(plan.inserts[0]!.canonicalKey === "KEY_NEW", "new key inserted");
  assert(plan.matches[0]!.partId === "uuid-a", "existing preserved");
}

{
  // Removed clip → soft retire (plan only; no hard delete)
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [clip({ order: 1, canonicalKey: "KEY_A", text: "A" })],
    existingParts: [
      part({ id: "uuid-a", order: 1, canonicalKey: "KEY_A", text: "A" }),
      part({ id: "uuid-gone", order: 2, canonicalKey: "KEY_GONE", text: "Gone" }),
    ],
  });
  assert(plan.retires.length === 1, "one retire");
  assert(plan.retires[0]!.partId === "uuid-gone", "retired missing key");
  assert(plan.matches[0]!.partId === "uuid-a", "kept matched");
}

{
  // Duplicate canonicalKey — two distinct parts remain
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [
      clip({ order: 1, canonicalKey: "DUP", text: "Hello?" }),
      clip({ order: 2, canonicalKey: "DUP", text: "Hello?" }),
    ],
    existingParts: [
      part({ id: "uuid-1", order: 1, canonicalKey: "DUP", text: "Hello?" }),
      part({ id: "uuid-2", order: 2, canonicalKey: "DUP", text: "Hello?" }),
    ],
  });
  assert(plan.matches.length === 2, "both dup occurrences matched");
  assert(plan.duplicateCanonicalKeyGroups === 1, "one dup group");
  const ids = new Set(plan.matches.map((m) => m.partId));
  assert(ids.has("uuid-1") && ids.has("uuid-2"), "no occurrence collapse");
  assert(plan.inserts.length === 0 && plan.retires.length === 0, "stable dups");
}

{
  // Duplicate reorder — positional zip is deterministic
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [
      clip({ order: 1, canonicalKey: "DUP", text: "Hello?" }),
      clip({ order: 5, canonicalKey: "DUP", text: "Hello?" }),
    ],
    existingParts: [
      part({ id: "uuid-early", order: 5, canonicalKey: "DUP", text: "Hello?" }),
      part({ id: "uuid-late", order: 10, canonicalKey: "DUP", text: "Hello?" }),
    ],
  });
  assert(plan.matches.length === 2, "dup reorder matched");
  // Sorted parts by order: early(5), late(10) → zip to pipeline orders 1, 5
  const byPart = new Map(plan.matches.map((m) => [m.partId, m]));
  assert(byPart.get("uuid-early")!.pipelineOrder === 1, "first part → first clip");
  assert(byPart.get("uuid-late")!.pipelineOrder === 5, "second part → second clip");
}

{
  // Idempotency of plan: same inputs → same match ids, zero inserts on second conceptual run
  const clips = [
    clip({ order: 1, canonicalKey: "A", text: "a" }),
    clip({ order: 2, canonicalKey: "B", text: "b" }),
  ];
  const parts = [
    part({ id: "u1", order: 1, canonicalKey: "A", text: "a" }),
    part({ id: "u2", order: 2, canonicalKey: "B", text: "b" }),
  ];
  const first = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: clips,
    existingParts: parts,
  });
  // Simulate post-apply state (orders/keys already aligned)
  const second = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: clips,
    existingParts: parts,
  });
  assert(first.inserts.length === 0 && second.inserts.length === 0, "no inserts");
  assert(first.retires.length === 0 && second.retires.length === 0, "no retires");
  assert(
    first.matches.map((m) => m.partId).join() ===
      second.matches.map((m) => m.partId).join(),
    "stable match ids",
  );
}

{
  // Dry-run flag propagates
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [clip({ order: 1, canonicalKey: "A", text: "a" })],
    existingParts: [],
    dryRun: true,
  });
  assert(plan.dryRun === true, "dry-run plan");
  assert(plan.inserts.length === 1, "dry-run still plans inserts");
}

{
  // Bootstrap: null-key part matches by exact order
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [clip({ order: 3, canonicalKey: "FROM_PIPE", text: "Hi" })],
    existingParts: [
      part({ id: "legacy", order: 3, canonicalKey: null, text: "Hi" }),
    ],
  });
  assert(plan.matches.length === 1, "bootstrap order match");
  assert(plan.matches[0]!.partId === "legacy", "legacy id preserved");
  assert(plan.matches[0]!.canonicalKey === "FROM_PIPE", "key attached via match");
}

{
  // Restore retired part when key reappears
  const plan = buildContentSyncPlan({
    episodeId: "ep1",
    pipelineClips: [clip({ order: 1, canonicalKey: "OLD", text: "Back" })],
    existingParts: [
      part({
        id: "retired-uuid",
        order: 10_000_001,
        canonicalKey: "OLD",
        text: "Back",
        retiredAt: new Date("2026-01-01"),
      }),
    ],
  });
  assert(plan.matches.length === 1, "restored match");
  assert(plan.matches[0]!.wasRetired === true, "wasRetired flag");
  assert(plan.inserts.length === 0, "no duplicate insert for restored");
}

{
  // Document parser: top-level object with clips[]
  const doc = parsePipelineClipsDocument({
    version: 3,
    clips: [
      {
        id: "p1",
        startMs: 0,
        endMs: 100,
        durationMs: 100,
        text: "Hello",
        level: "easy",
        difficultyScore: 1,
        tokens: [],
        canonicalKey: "abc",
      },
    ],
  });
  assert(doc.clips.length === 1, "parsed one clip");
  assert(doc.clips[0]!.order === 1, "order from array index");
  assert(doc.clips[0]!.canonicalKey === "abc", "canonicalKey required");
}

{
  let threw = false;
  try {
    parsePipelineClipsDocument({ clips: [{ text: "x", startMs: 0, endMs: 1, durationMs: 1 }] });
  } catch {
    threw = true;
  }
  assert(threw, "missing canonicalKey rejected");
}

console.log("contentSync: ok");
