import {
  pipelineClipToOwnedPayload,
} from "./contentFieldOwnership";
import type {
  ContentSyncAmbiguity,
  ContentSyncInsert,
  ContentSyncMatch,
  ContentSyncPlan,
  ContentSyncRetire,
  ExistingSyncPart,
  PipelineClip,
} from "./types";

function groupByKey<T>(
  items: T[],
  keyFn: (item: T) => string | null,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function contentChanged(
  part: ExistingSyncPart,
  clip: PipelineClip,
): boolean {
  const owned = pipelineClipToOwnedPayload(clip);
  if (part.text !== owned.text) return true;
  if (part.canonicalKey !== owned.canonicalKey) return true;
  if ((part.playbackStartMs ?? null) !== owned.playbackStartMs) return true;
  if ((part.playbackEndMs ?? null) !== owned.playbackEndMs) return true;
  if ((part.playbackDurationMs ?? null) !== owned.playbackDurationMs) return true;
  if ((part.speechStartMs ?? null) !== owned.speechStartMs) return true;
  if ((part.speechEndMs ?? null) !== owned.speechEndMs) return true;
  if ((part.speechDurationMs ?? null) !== owned.speechDurationMs) return true;
  if (part.difficulty !== owned.difficulty) return true;
  if ((part.difficultyScore ?? null) !== (owned.difficultyScore ?? null)) {
    return true;
  }
  if (part.wordCount !== owned.wordCount) return true;
  if ((part.speechRate ?? null) !== (owned.speechRate ?? null)) return true;

  // Compare token surfaces, not JSON shape (DB hydration normalizes tokens).
  const existingSurfaces = tokenSurfaces(part.tokensJson);
  const incomingSurfaces = owned.tokens.map(
    (t) => String(t.value ?? t.text ?? "").trim(),
  );
  if (existingSurfaces.length !== incomingSurfaces.length) return true;
  for (let i = 0; i < existingSurfaces.length; i++) {
    if (existingSurfaces[i] !== incomingSurfaces[i]) return true;
  }
  return false;
}

function tokenSurfaces(tokensJson: string | null): string[] {
  if (!tokensJson) return [];
  try {
    const raw = JSON.parse(tokensJson) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map((t) => {
      if (t == null || typeof t !== "object") return "";
      const o = t as Record<string, unknown>;
      return String(o.value ?? o.text ?? "").trim();
    });
  } catch {
    return [];
  }
}

function makeMatch(
  part: ExistingSyncPart,
  clip: PipelineClip,
): ContentSyncMatch {
  return {
    partId: part.id,
    pipelineOrder: clip.order,
    canonicalKey: clip.canonicalKey,
    previousOrder: part.order,
    wasRetired: part.retiredAt != null,
    contentChanged: contentChanged(part, clip),
    orderChanged: part.order !== clip.order || part.retiredAt != null,
  };
}

/**
 * Deterministic pairing for a shared canonicalKey group.
 *
 * When counts match: zip by sorted presentation order (handles duplicate reorder).
 * When counts differ: zip min(n,m) by sorted order; extras become inserts/retires.
 * Never collapses multiple occurrences into one part.
 */
function reconcileKeyGroup(params: {
  canonicalKey: string;
  clips: PipelineClip[];
  parts: ExistingSyncPart[];
  usedPartIds: Set<string>;
  usedClipOrders: Set<number>;
  matches: ContentSyncMatch[];
  inserts: ContentSyncInsert[];
  ambiguousMatches: ContentSyncAmbiguity[];
}): void {
  const clips = [...params.clips].sort((a, b) => a.order - b.order);
  const parts = [...params.parts]
    .filter((p) => !params.usedPartIds.has(p.id))
    .sort((a, b) => {
      // Prefer active over retired at the same order, then by order.
      const aRet = a.retiredAt != null ? 1 : 0;
      const bRet = b.retiredAt != null ? 1 : 0;
      if (a.order !== b.order) return a.order - b.order;
      return aRet - bRet;
    });

  if (clips.length === 0) return;
  // No existing keyed parts — leave clips unmatched so bootstrap (order) or
  // final insert pass can handle them without consuming orders early.
  if (parts.length === 0) return;

  const pairCount = Math.min(clips.length, parts.length);
  for (let i = 0; i < pairCount; i++) {
    const clip = clips[i]!;
    const part = parts[i]!;
    if (params.usedClipOrders.has(clip.order) || params.usedPartIds.has(part.id)) {
      params.ambiguousMatches.push({
        canonicalKey: params.canonicalKey,
        reason: "occurrence already claimed during key-group pairing",
        pipelineOrders: [clip.order],
        partIds: [part.id],
      });
      continue;
    }
    params.usedClipOrders.add(clip.order);
    params.usedPartIds.add(part.id);
    params.matches.push(makeMatch(part, clip));
  }

  for (let i = pairCount; i < clips.length; i++) {
    const clip = clips[i]!;
    if (params.usedClipOrders.has(clip.order)) continue;
    params.usedClipOrders.add(clip.order);
    params.inserts.push({
      pipelineOrder: clip.order,
      canonicalKey: clip.canonicalKey,
      clip,
    });
  }
}

/**
 * Build a reconciliation plan for one episode.
 * Pure — no DB I/O.
 */
export function buildContentSyncPlan(params: {
  episodeId: string;
  pipelineClips: PipelineClip[];
  existingParts: ExistingSyncPart[];
  dryRun?: boolean;
}): ContentSyncPlan {
  const dryRun = params.dryRun === true;
  const clips = params.pipelineClips;
  const existing = params.existingParts;

  const active = existing.filter((p) => p.retiredAt == null);
  const retired = existing.filter((p) => p.retiredAt != null);

  const usedPartIds = new Set<string>();
  const usedClipOrders = new Set<number>();
  const matches: ContentSyncMatch[] = [];
  const inserts: ContentSyncInsert[] = [];
  const ambiguousMatches: ContentSyncAmbiguity[] = [];

  const clipGroups = groupByKey(clips, (c) => c.canonicalKey);
  const partGroups = groupByKey(
    [...active, ...retired],
    (p) => p.canonicalKey,
  );

  let duplicateCanonicalKeyGroups = 0;
  for (const [, group] of clipGroups) {
    if (group.length > 1) duplicateCanonicalKeyGroups++;
  }

  // Level 1–2: keyed reconciliation (positional zip within each key).
  for (const [canonicalKey, groupClips] of clipGroups) {
    const groupParts = partGroups.get(canonicalKey) ?? [];
    reconcileKeyGroup({
      canonicalKey,
      clips: groupClips,
      parts: groupParts,
      usedPartIds,
      usedClipOrders,
      matches,
      inserts,
      ambiguousMatches,
    });
  }

  // Level 0 bootstrap: null-key active parts matched by exact order.
  for (const part of active) {
    if (part.canonicalKey) continue;
    if (usedPartIds.has(part.id)) continue;
    const clip = clips.find((c) => c.order === part.order);
    if (!clip || usedClipOrders.has(clip.order)) continue;
    usedPartIds.add(part.id);
    usedClipOrders.add(clip.order);
    matches.push(makeMatch(part, clip));
  }

  // Remaining unmatched pipeline clips → insert
  for (const clip of clips) {
    if (usedClipOrders.has(clip.order)) continue;
    usedClipOrders.add(clip.order);
    inserts.push({
      pipelineOrder: clip.order,
      canonicalKey: clip.canonicalKey,
      clip,
    });
  }

  // Remaining unmatched active parts → retire
  const retires: ContentSyncRetire[] = [];
  for (const part of active) {
    if (usedPartIds.has(part.id)) continue;
    retires.push({
      partId: part.id,
      previousOrder: part.order,
      canonicalKey: part.canonicalKey,
    });
  }

  return {
    episodeId: params.episodeId,
    pipelineClipCount: clips.length,
    existingActiveCount: active.length,
    existingRetiredCount: retired.length,
    matches,
    inserts,
    retires,
    ambiguousMatches,
    duplicateCanonicalKeyGroups,
    dryRun,
  };
}

export function summarizeContentSyncPlan(
  plan: ContentSyncPlan,
): import("./types").ContentSyncReport {
  const updated = plan.matches.filter((m) => m.contentChanged).length;
  const reordered = plan.matches.filter((m) => m.orderChanged).length;
  const restored = plan.matches.filter((m) => m.wasRetired).length;
  return {
    episodeId: plan.episodeId,
    pipelineClipCount: plan.pipelineClipCount,
    existingPartCount: plan.existingActiveCount + plan.existingRetiredCount,
    existingActiveCount: plan.existingActiveCount,
    matched: plan.matches.length,
    inserted: plan.inserts.length,
    updated,
    reordered,
    restored,
    retired: plan.retires.length,
    duplicateCanonicalKeyGroups: plan.duplicateCanonicalKeyGroups,
    ambiguousMatches: plan.ambiguousMatches,
    dryRun: plan.dryRun,
  };
}
