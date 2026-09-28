import type { PipelineClip, PipelineClipToken } from "@/lib/content-sync/types";
import { isDictionaryLookupExcludedForm } from "@/lib/dictionary/dictionaryLookupExclusion";
import {
  normalizeDictionaryLookupSurface,
  resolveDictionaryInventoryLemma,
} from "@/lib/dictionary/normalizeDictionaryLemma";

export type ClipDictionaryLemmaInventoryEntry = {
  lemma: string;
  occurrenceCount: number;
  clipCount: number;
};

export type ClipDictionaryLemmaInventory = {
  totalWordTokenInstances: number;
  excludedCoreLemmaCount: number;
  eligibleLemmas: ClipDictionaryLemmaInventoryEntry[];
};

function isWordToken(token: PipelineClipToken): boolean {
  if (token.type === "punctuation") {
    return false;
  }
  if (token.punctuationType) {
    return false;
  }
  const surface = (token.value ?? token.text ?? "").trim();
  if (!surface) {
    return false;
  }
  return token.type !== "punctuation";
}

function tokenSurface(token: PipelineClipToken): string {
  return (token.value ?? token.text ?? "").trim();
}

function isInventoryEligibleWordToken(
  surface: string,
  lemma: string,
): boolean {
  const surfaceNorm = normalizeDictionaryLookupSurface(surface);
  if (!surfaceNorm) {
    return false;
  }
  return !isDictionaryLookupExcludedForm(surface, lemma);
}

/** Inventory-only helper for dictionary coverage during content refresh. */
export function buildClipDictionaryLemmaInventory(
  clips: readonly PipelineClip[],
): ClipDictionaryLemmaInventory {
  const lemmaStats = new Map<
    string,
    { occurrenceCount: number; clipIds: Set<string> }
  >();
  let totalWordTokenInstances = 0;
  let excludedCoreLemmaCount = 0;

  for (const clip of clips) {
    const clipKey = clip.canonicalKey || clip.pipelineId;
    for (const token of clip.tokens ?? []) {
      if (!isWordToken(token)) {
        continue;
      }
      totalWordTokenInstances += 1;

      const surface = tokenSurface(token);
      const inventoryLemma = resolveDictionaryInventoryLemma(
        surface,
        token.lemma,
      );
      if (!inventoryLemma) {
        continue;
      }

      if (!isInventoryEligibleWordToken(surface, token.lemma ?? surface)) {
        excludedCoreLemmaCount += 1;
        continue;
      }

      let bucket = lemmaStats.get(inventoryLemma);
      if (!bucket) {
        bucket = { occurrenceCount: 0, clipIds: new Set<string>() };
        lemmaStats.set(inventoryLemma, bucket);
      }
      bucket.occurrenceCount += 1;
      bucket.clipIds.add(clipKey);
    }
  }

  const eligibleLemmas = [...lemmaStats.entries()]
    .map(([lemma, stats]) => ({
      lemma,
      occurrenceCount: stats.occurrenceCount,
      clipCount: stats.clipIds.size,
    }))
    .sort((a, b) => a.lemma.localeCompare(b.lemma));

  return {
    totalWordTokenInstances,
    excludedCoreLemmaCount,
    eligibleLemmas,
  };
}
