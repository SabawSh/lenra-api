import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  buildSectionLearningUnits,
  type BuildSectionLearningUnitsOptions,
  type SectionPartForLearningUnits,
} from "@/lib/learning/buildSectionLearningUnits";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { resolveSpeechDurationMs } from "@/lib/learning/partTiming";
import { isSectionVisuallyComplete } from "@/lib/learning/visibleUnitProgress";
import { isCatalogEntryUnlockCompleteSync } from "@/lib/learning/sectionUnlockCompletion";
import type { AtomicPartInput, LearningUnit } from "@/lib/skill-engine/learning-units";

export type VisibleSectionPlaylistResult<
  T extends SectionPartForLearningUnits,
> = {
  atomicParts: T[];
  learningUnits: LearningUnit<T>[];
  /**
   * Progress-neutral visible unit boundaries (sizing build) — source of truth for
   * completion, unlock, and replay eligibility. User progress must not split
   * completed clips into extra units here, or the first 10 units can look done
   * while later parts in the section slice are still incomplete.
   */
  progressionUnits: LearningUnit<T>[];
  globalStartIndex: number;
  atomicPartCount: number;
  /** Section-level replay decision applied to the final selected build. */
  replayMergeEligible?: boolean;
};

function resolveSectionReplayMergeEligible<T extends SectionPartForLearningUnits>(
  visibleUnits: ReadonlyArray<LearningUnit<T>>,
  progressMap?: Map<string, AtomicPartInput["progress"]>,
): boolean {
  if (!progressMap?.size) return false;
  const unitsWithProgress = visibleUnits.map((unit) => ({
    ...unit,
    parts: unit.parts.map((part) => ({
      ...part,
      progress: progressMap.get(part.id) ?? null,
    })),
  }));
  return isSectionVisuallyComplete(unitsWithProgress);
}

const EMPTY_PROGRESS_MAP = new Map<string, AtomicPartInput["progress"]>();

/** Progress must not shrink section frontiers — completed clips become atomic and inflate unit counts. */
function sizingBuildOptions(
  options?: BuildSectionLearningUnitsOptions,
): BuildSectionLearningUnitsOptions {
  return {
    ...options,
    prefetchedProgressMap: EMPTY_PROGRESS_MAP,
    replayMergeEligible: false,
    suppressMergeDebug: true,
  };
}

/** Catalog walks must not leak the requested section's debug id into earlier sections. */
export function sectionScopedBuildOptions(
  options: BuildSectionLearningUnitsOptions | undefined,
  sectionIndex: number,
): BuildSectionLearningUnitsOptions {
  if (!options) return { sectionIndex };
  const { sectionId, sectionIndex: _ignored, ...rest } = options;
  const prefix =
    sectionId != null ? sectionId.replace(/:section:\d+$/, "") : undefined;
  return {
    ...rest,
    sectionIndex,
    ...(prefix != null
      ? { sectionId: `${prefix}:section:${sectionIndex}` }
      : {}),
  };
}

function trimToVisibleUnits<T extends SectionPartForLearningUnits>(
  slice: readonly T[],
  units: LearningUnit<T>[],
): { atomicParts: T[]; learningUnits: LearningUnit<T>[] } {
  const learningUnits = units.slice(0, VISIBLE_UNITS_PER_SECTION);
  const usedIds = new Set(
    learningUnits.flatMap((unit) => unit.parts.map((part) => part.id)),
  );
  const atomicParts = slice.filter((part) => usedIds.has(part.id));
  return { atomicParts, learningUnits };
}

/** Progression boundaries for the clips the learner actually plays in this section. */
async function buildProgressionUnitsFromAtomicParts<
  T extends SectionPartForLearningUnits,
>(
  parts: readonly T[],
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<LearningUnit<T>[]> {
  if (parts.length === 0) return [];
  const sizingUnits = await buildSectionLearningUnits(
    parts,
    user,
    undefined,
    sizingBuildOptions(options),
  );
  return trimToVisibleUnits(parts, sizingUnits).learningUnits;
}

/** Full sections must expose 10 visible units; replay merge must not shrink below that. */
function finalizeSectionPlaylist<T extends SectionPartForLearningUnits>(
  slice: readonly T[],
  units: LearningUnit<T>[],
  frontierUnits: LearningUnit<T>[],
  replayMergeEligible: boolean,
): {
  trimmed: { atomicParts: T[]; learningUnits: LearningUnit<T>[] };
  replayMergeEligible: boolean;
} {
  let trimmed = trimToVisibleUnits(slice, units);
  const frontierCanFill =
    frontierUnits.length >= VISIBLE_UNITS_PER_SECTION;

  if (
    frontierCanFill &&
    trimmed.learningUnits.length < VISIBLE_UNITS_PER_SECTION
  ) {
    trimmed = trimToVisibleUnits(slice, frontierUnits);
    replayMergeEligible = false;
  }

  return { trimmed, replayMergeEligible };
}

/** Hydrates curriculum parts on demand while walking the section catalog. */
export class IncrementalHydratedPool<T extends SectionPartForLearningUnits> {
  private readonly slots: Array<T | undefined>;

  constructor(
    private readonly orderRefs: readonly { id: string }[],
    private readonly hydrate: (ids: readonly string[]) => Promise<readonly T[]>,
  ) {
    this.slots = new Array(orderRefs.length);
  }

  get length(): number {
    return this.orderRefs.length;
  }

  async ensureLoaded(start: number, count: number): Promise<void> {
    const end = Math.min(start + count, this.orderRefs.length);
    const missingIds: string[] = [];
    const missingIndices: number[] = [];
    for (let i = start; i < end; i++) {
      if (this.slots[i] != null) continue;
      missingIds.push(this.orderRefs[i]!.id);
      missingIndices.push(i);
    }
    if (missingIds.length === 0) return;

    const hydrated = await this.hydrate(missingIds);
    const byId = new Map(hydrated.map((part) => [part.id, part]));
    for (let j = 0; j < missingIds.length; j++) {
      const part = byId.get(missingIds[j]!);
      if (part) this.slots[missingIndices[j]!] = part;
    }
  }

  async slice(start: number, count: number): Promise<T[]> {
    await this.ensureLoaded(start, count);
    const out: T[] = [];
    const end = Math.min(start + count, this.length);
    for (let i = start; i < end; i++) {
      const part = this.slots[i];
      if (part) out.push(part);
    }
    return out;
  }

  loadedPartIds(): string[] {
    const ids: string[] = [];
    for (const part of this.slots) {
      if (part) ids.push(part.id);
    }
    return ids;
  }
}

/** Build one visible section from a pre-hydrated global curriculum pool (no DB). */
export async function buildVisibleSectionPlaylistFromPool<
  T extends SectionPartForLearningUnits,
>(
  hydratedPool: readonly T[],
  globalStartIndex: number,
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<VisibleSectionPlaylistResult<T>> {
  const available = hydratedPool.length - globalStartIndex;
  if (available <= 0) {
    return {
      atomicParts: [],
      learningUnits: [],
      progressionUnits: [],
      globalStartIndex,
      atomicPartCount: 0,
    };
  }

  function slicePrefix(count: number): T[] {
    return hydratedPool.slice(globalStartIndex, globalStartIndex + count);
  }

  return buildVisibleSectionPlaylistFromSlice({
    slicePrefix,
    available,
    globalStartIndex,
    user,
    options,
  });
}

async function buildVisibleSectionPlaylistFromSlice<
  T extends SectionPartForLearningUnits,
>({
  slicePrefix,
  available,
  globalStartIndex,
  user,
  options,
}: {
  slicePrefix: (count: number) => T[] | Promise<T[]>;
  available: number;
  globalStartIndex: number;
  user: AdaptiveOrderUser | null;
  options?: BuildSectionLearningUnitsOptions;
}): Promise<VisibleSectionPlaylistResult<T>> {
  async function buildUnitsForCount(
    count: number,
    buildOptions: BuildSectionLearningUnitsOptions = options ?? {},
  ): Promise<LearningUnit<T>[]> {
    const parts = await slicePrefix(count);
    if (buildOptions.beforeUnitsBuild && parts.length > 0) {
      await buildOptions.beforeUnitsBuild(parts.map((part) => part.id));
    }
    return buildSectionLearningUnits(parts, user, undefined, buildOptions);
  }

  async function buildSizingUnitsForCount(
    count: number,
  ): Promise<LearningUnit<T>[]> {
    return buildUnitsForCount(count, sizingBuildOptions(options));
  }

  /** Fixed unit boundaries for unlock/completion — never progress-inflated. */
  async function buildProgressionUnitsForCount(
    count: number,
    slice: readonly T[],
  ): Promise<LearningUnit<T>[]> {
    const sizingUnits = await buildSizingUnitsForCount(count);
    return trimToVisibleUnits(slice, sizingUnits).learningUnits;
  }

  const availableSizingUnits = await buildSizingUnitsForCount(available);
  if (availableSizingUnits.length < VISIBLE_UNITS_PER_SECTION) {
    const shortSlice = await slicePrefix(available);
    // Hydration miss (e.g. stale cached part UUIDs after content rebuild): do not
    // advance the catalog by `available` or the whole curriculum collapses into
    // one empty section and Learn calls notFound().
    if (shortSlice.length === 0) {
      return {
        atomicParts: [],
        learningUnits: [],
        progressionUnits: [],
        globalStartIndex,
        atomicPartCount: 0,
      };
    }
    const progressionUnits = await buildProgressionUnitsForCount(
      available,
      shortSlice,
    );
    let replayMergeEligible = resolveSectionReplayMergeEligible(
      progressionUnits,
      options?.prefetchedProgressMap,
    );
    let finalUnits = availableSizingUnits;
    if (replayMergeEligible) {
      const replayUnits = await buildUnitsForCount(available, {
        ...options,
        replayMergeEligible: true,
      });
      if (replayUnits.length >= availableSizingUnits.length) {
        finalUnits = replayUnits;
      } else {
        replayMergeEligible = false;
      }
    }

    const trimmedPlayback = trimToVisibleUnits(shortSlice, finalUnits);
    const alignedProgressionUnits = await buildProgressionUnitsFromAtomicParts(
      trimmedPlayback.atomicParts,
      user,
      options,
    );

    return {
      atomicParts: trimmedPlayback.atomicParts,
      learningUnits: trimmedPlayback.learningUnits,
      progressionUnits:
        alignedProgressionUnits.length > 0
          ? alignedProgressionUnits
          : progressionUnits,
      globalStartIndex,
      atomicPartCount: available,
      replayMergeEligible,
    };
  }

  let lo = 1;
  let hi = available;
  let best = available;

  while (lo <= hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const trialUnits = await buildSizingUnitsForCount(mid);
    if (trialUnits.length >= VISIBLE_UNITS_PER_SECTION) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const slice = await slicePrefix(best);
  const sizingUnits = await buildSizingUnitsForCount(best);
  const progressionUnits = await buildProgressionUnitsForCount(best, slice);

  let replayMergeEligible = resolveSectionReplayMergeEligible(
    progressionUnits,
    options?.prefetchedProgressMap,
  );

  // In-progress playback uses progress-neutral unit boundaries so merges survive refresh.
  let units = sizingUnits;
  if (replayMergeEligible) {
    const replayUnits = await buildUnitsForCount(best, {
      ...options,
      replayMergeEligible: true,
    });
    if (replayUnits.length >= VISIBLE_UNITS_PER_SECTION) {
      units = replayUnits;
    } else {
      replayMergeEligible = false;
    }
  }

  const { trimmed, replayMergeEligible: appliedReplay } = finalizeSectionPlaylist(
    slice,
    units,
    sizingUnits,
    replayMergeEligible,
  );

  const alignedProgressionUnits = await buildProgressionUnitsFromAtomicParts(
    trimmed.atomicParts,
    user,
    options,
  );

  return {
    ...trimmed,
    progressionUnits:
      alignedProgressionUnits.length > 0
        ? alignedProgressionUnits
        : progressionUnits,
    globalStartIndex,
    atomicPartCount: best,
    replayMergeEligible: appliedReplay,
  };
}

/** Build one section from an incrementally hydrated pool (lazy DB reads). */
export async function buildVisibleSectionPlaylistFromIncrementalPool<
  T extends SectionPartForLearningUnits,
>(
  pool: IncrementalHydratedPool<T>,
  globalStartIndex: number,
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<VisibleSectionPlaylistResult<T>> {
  const available = pool.length - globalStartIndex;
  if (available <= 0) {
    return {
      atomicParts: [],
      learningUnits: [],
      progressionUnits: [],
      globalStartIndex,
      atomicPartCount: 0,
    };
  }

  return buildVisibleSectionPlaylistFromSlice({
    slicePrefix: (count) => pool.slice(globalStartIndex, count),
    available,
    globalStartIndex,
    user,
    options,
  });
}

export type VisibleSectionCatalogPageOptions = {
  /** First section index to include in the returned catalog (still walks earlier sections for offsets). */
  startSectionIndex?: number;
  /** Max sections to return after `startSectionIndex`. */
  sectionLimit?: number;
  /** @deprecated Use `sectionLimit` — max sections to build from the start of the curriculum. */
  maxSections?: number;
  /**
   * Stop walking once a returned section is not fully complete.
   * Later sections in the page are locked — skip building them (unlock list only).
   */
  stopAtFirstIncomplete?: boolean;
};

/**
 * Pull atomic clips from the global curriculum until we have 10 visible learning units.
 * Hydrates the remaining tail once; prefer {@link computeVisibleSectionCatalog} for batches.
 */
export async function buildVisibleSectionPlaylist<
  T extends SectionPartForLearningUnits,
>(
  globallyOrderedParts: readonly { id: string }[],
  globalStartIndex: number,
  hydrate: (ids: readonly string[]) => Promise<readonly T[]>,
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<VisibleSectionPlaylistResult<T>> {
  const rangeIds = globallyOrderedParts
    .slice(globalStartIndex)
    .map((part) => part.id);
  const hydratedTail = await hydrate(rangeIds);
  const byId = new Map(hydratedTail.map((part) => [part.id, part]));
  const pool = rangeIds
    .map((id) => byId.get(id))
    .filter((part): part is T => part != null);

  const result = await buildVisibleSectionPlaylistFromPool(
    pool,
    0,
    user,
    options,
  );
  return {
    ...result,
    globalStartIndex,
  };
}

export type VisibleSectionCatalogPageResult<
  T extends SectionPartForLearningUnits,
> = {
  entries: Array<VisibleSectionPlaylistResult<T> & { sectionIndex: number }>;
  hasMoreSections: boolean;
  /** First incomplete section (playable). Prior sections are complete. */
  unlockFrontierSection?: number;
};

/** Walk the global curriculum — hydrates parts incrementally per section. */
export async function computeVisibleSectionCatalog<
  T extends SectionPartForLearningUnits,
>(
  globallyOrderedParts: readonly { id: string }[],
  hydrate: (ids: readonly string[]) => Promise<readonly T[]>,
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
  page?: VisibleSectionCatalogPageOptions,
): Promise<VisibleSectionCatalogPageResult<T>> {
  const startSectionIndex = Math.max(1, page?.startSectionIndex ?? 1);
  const sectionLimit =
    page?.sectionLimit ?? page?.maxSections ?? Number.POSITIVE_INFINITY;

  const pool = new IncrementalHydratedPool(globallyOrderedParts, hydrate);
  const entries: Array<
    VisibleSectionPlaylistResult<T> & { sectionIndex: number }
  > = [];
  let offset = 0;
  let sectionIndex = 1;
  let unlockFrontierSection: number | undefined;

  while (offset < pool.length) {
    const result = await buildVisibleSectionPlaylistFromIncrementalPool(
      pool,
      offset,
      user,
      sectionScopedBuildOptions(options, sectionIndex),
    );
    if (result.atomicPartCount === 0) break;

    const entry = { sectionIndex, ...result };
    if (sectionIndex >= startSectionIndex && entries.length < sectionLimit) {
      entries.push(entry);
    }

    offset += result.atomicPartCount;
    const hasRemainingParts = offset < pool.length;

    // Unlock frontier: never walk past an incomplete section, even when the
    // requested page starts later (otherwise later pages skip the frontier).
    if (
      page?.stopAtFirstIncomplete &&
      !isCatalogEntryUnlockCompleteSync(
        entry,
        options?.prefetchedProgressMap ?? new Map(),
      )
    ) {
      unlockFrontierSection = sectionIndex;
      return {
        entries,
        hasMoreSections: hasRemainingParts || sectionIndex < startSectionIndex,
        unlockFrontierSection,
      };
    }

    if (sectionIndex >= startSectionIndex + sectionLimit - 1) {
      unlockFrontierSection = sectionIndex + 1;
      return {
        entries,
        hasMoreSections: hasRemainingParts,
        unlockFrontierSection,
      };
    }

    sectionIndex++;
    if (!hasRemainingParts) break;
  }

  if (entries.length > 0) {
    unlockFrontierSection = entries[entries.length - 1]!.sectionIndex + 1;
  }

  return { entries, hasMoreSections: false, unlockFrontierSection };
}
