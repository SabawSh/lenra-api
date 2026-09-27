import {
  getEpisodePartsOrderMeta,
  getVideoPartsOrderMeta,
  hydrateSectionPartsFromOrderMeta,
} from "@/lib/db/parts";
import {
  createMaterializedSectionBlueprint,
  deleteMaterializedSectionById,
  findMaterializedSectionHeader,
  listMaterializedSectionHeaders,
  loadMaterializedSectionBlueprint,
} from "@/lib/db/queries/userMaterializedSections";
import * as videoQueries from "@/lib/db/queries/videos";
import {
  computeVisibleSectionCatalog,
  type VisibleSectionCatalogPageOptions,
  type VisibleSectionCatalogPageResult,
  type VisibleSectionPlaylistResult,
} from "@/lib/learning/buildVisibleSectionPlaylist";
import {
  LEARNER_FORCE_ATOMIC_UNITS,
  type BuildSectionLearningUnitsOptions,
  type SectionPartForLearningUnits,
} from "@/lib/learning/buildSectionLearningUnits";
import {
  getAdaptiveEpisodeOrder,
  type AdaptiveOrderUser,
  type EpisodePartForAdaptiveOrder,
} from "@/lib/learning/adaptiveEpisodeOrdering";
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import { resolveSkillForAdaptiveOrdering } from "@/lib/skill/computeOverallSkill";
import { getBootstrapSkillFromEnglishLevel } from "@/lib/skill/onboardingSkill";
import { assertSkillResult } from "@/lib/skill/skillTypes";
import type { AtomicPartInput } from "@/lib/skill-engine/learning-units";
import {
  countCompletedVisibleUnits,
  isSectionVisuallyComplete,
} from "@/lib/learning/visibleUnitProgress";
import {
  isCatalogEntryUnlockCompleteSync,
  type SectionUnlockProgressSlice,
} from "@/lib/learning/sectionUnlockCompletion";
export {
  computeUnlockFrontierSection,
  isCatalogEntryUnlockCompleteSync,
} from "@/lib/learning/sectionUnlockCompletion";
import { resolveSpeechDurationMs } from "@/lib/learning/partTiming";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";
import type { Part } from "@/types/video";
import {
  curriculumVersionFromPartOrder,
  playlistHasMergedLearningUnits,
  reconstructPlaylistFromBlueprint,
  unitPartIdsFromLearningUnits,
} from "@/lib/learning/materializedSectionBlueprint";

export type SectionCurriculumScope =
  | { episodeId: string; curriculumId: string }
  | { videoId: string; curriculumId: string };

export type ProgressionSectionLoadMode = "dynamic" | "read-only" | "get-or-create";

type ProgressionSectionScope = {
  scope: SectionCurriculumScope;
  videoId: string;
  episodeId: string | null;
};

/** Lean merge inputs for catalog/unlock — one query, no translations. */
async function hydrateLearningMetaByIds(ids: readonly string[]) {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  return dashTime(`SQL listPartLearningMetaByIds(n=${ids.length})`, () =>
    videoQueries.listPartLearningMetaByIds(ids),
  );
}

function scopeIds(scope: ProgressionSectionScope): {
  videoId: string;
  episodeId: string | null;
  scopeKey: string;
} {
  return {
    videoId: scope.videoId,
    episodeId: "episodeId" in scope.scope ? scope.scope.episodeId : scope.episodeId,
    scopeKey: scope.scope.curriculumId,
  };
}

async function resolveCurriculumVersion(scope: SectionCurriculumScope): Promise<string> {
  const curriculumParts =
    "episodeId" in scope
      ? await getEpisodePartsOrderMeta(scope.episodeId)
      : await getVideoPartsOrderMeta(scope.videoId);
  return curriculumVersionFromPartOrder(curriculumParts);
}

async function hydrateMaterializedPlaylist(
  sectionId: number,
): Promise<VisibleSectionPlaylistResult<SectionPartForLearningUnits> | null> {
  const blueprint = await loadMaterializedSectionBlueprint(sectionId);
  if (!blueprint) return null;
  const orderedParts = await hydrateLearningMetaByIds(
    blueprint.atomicParts
      .sort((a, b) => a.order - b.order)
      .map((row) => row.partId),
  );
  const reconstructed = reconstructPlaylistFromBlueprint(blueprint, orderedParts);
  return {
    atomicParts: reconstructed.atomicParts,
    learningUnits: reconstructed.learningUnits,
    progressionUnits: reconstructed.progressionUnits,
    globalStartIndex: blueprint.header.globalStartIndex ?? 0,
    atomicPartCount: reconstructed.atomicParts.length,
  };
}

async function loadExistingMaterializedPlaylist(
  params: ProgressionSectionScope & {
    userId: string;
    sectionIndex: number;
  },
): Promise<VisibleSectionPlaylistResult<SectionPartForLearningUnits> | null> {
  const header = await findMaterializedSectionHeader({
    userId: params.userId,
    sectionIndex: params.sectionIndex,
    ...scopeIds(params),
  });
  if (!header) return null;
  return hydrateMaterializedPlaylist(header.id);
}

async function extendProgressMap(
  user: AdaptiveOrderUser,
  partIds: readonly string[],
  progressMap: Map<string, AtomicPartInput["progress"]>,
): Promise<void> {
  const missing = partIds.filter((id) => !progressMap.has(id));

  if (partIds.length === 0) return;
  if (missing.length === 0) return;

  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const slices = await dashTime(
    `SQL extendProgressMap listProgressSlice(n=${missing.length})`,
    () => listProgressSliceForParts(user.id, missing),
  );
  for (const slice of slices) {
    progressMap.set(slice.partId, {
      bestScore: slice.bestScore,
      completedAt: slice.completedAt,
      attempts: slice.attempts,
      wrongMoves: slice.wrongMoves,
      sessionSectionIndex: slice.sessionSectionIndex,
    } as AtomicPartInput["progress"]);
  }
  // Critical: parts with no DB row must still be marked present, otherwise
  // every later beforeUnitsBuild treats them as missing and re-queries (N+1).
  for (const id of missing) {
    if (!progressMap.has(id)) {
      progressMap.set(id, null);
    }
  }
}

/**
 * One SQL for the whole curriculum — subsequent beforeUnitsBuild calls hit a
 * warm map and issue zero queries (eliminates binary-search N+1).
 */
async function prefetchAllProgressForCatalog(
  user: AdaptiveOrderUser,
  partIds: readonly string[],
  progressMap: Map<string, AtomicPartInput["progress"]>,
): Promise<void> {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  await dashTime(
    `SQL prefetchAllProgressForCatalog(n=${partIds.length})`,
    () => extendProgressMap(user, partIds, progressMap),
  );
}

async function prefetchCatalogBuildContext(
  user: AdaptiveOrderUser | null,
): Promise<Pick<
  BuildSectionLearningUnitsOptions,
  "prefetchedUserSkill" | "prefetchedProgressMap"
>> {
  if (!user) return {};

  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const skillResult = await dashTime(
    "resolveSkillForAdaptiveOrdering(catalogPrefetch)",
    () => resolveSkillForAdaptiveOrdering(user.id),
  );
  assertSkillResult(skillResult);
  const prefetchedUserSkill =
    skillResult.stage === "new_user"
      ? getBootstrapSkillFromEnglishLevel(user.englishLevel)
      : skillResult.skill;

  return {
    prefetchedUserSkill,
    prefetchedProgressMap: new Map<string, AtomicPartInput["progress"]>(),
  };
}

function catalogBuildOptions(
  user: AdaptiveOrderUser | null,
  prefetch: Pick<
    BuildSectionLearningUnitsOptions,
    "prefetchedUserSkill" | "prefetchedProgressMap"
  >,
  options?: BuildSectionLearningUnitsOptions,
): BuildSectionLearningUnitsOptions {
  const progressMap = prefetch.prefetchedProgressMap;
  return {
    ...options,
    ...prefetch,
    beforeUnitsBuild:
      user && progressMap
        ? async (partIds) => extendProgressMap(user, partIds, progressMap)
        : options?.beforeUnitsBuild,
  };
}

export async function loadCurriculumGlobalOrder(
  scope: SectionCurriculumScope,
  user: AdaptiveOrderUser | null,
  totalParts: number,
): Promise<EpisodePartForAdaptiveOrder[]> {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const curriculumParts = await dashTime(
    "episodeId" in scope
      ? "SQL getEpisodePartsOrderMeta"
      : "SQL getVideoPartsOrderMeta",
    () =>
      "episodeId" in scope
        ? getEpisodePartsOrderMeta(scope.episodeId)
        : getVideoPartsOrderMeta(scope.videoId),
  );

  if (curriculumParts.length === 0) return [];

  return dashTime("getAdaptiveEpisodeOrder", () =>
    getAdaptiveEpisodeOrder({
      episodeParts: curriculumParts,
      user,
      context: {
        curriculumId: scope.curriculumId,
        totalParts,
      },
    }),
  );
}

export type VisibleSectionCatalogEntry = VisibleSectionPlaylistResult<
  SectionPartForLearningUnits
> & { sectionIndex: number };

/** Single linear pass — builds sections 1..maxSections (or all if omitted). */
export async function loadVisibleSectionCatalog(
  globalOrder: readonly EpisodePartForAdaptiveOrder[],
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
  page?: VisibleSectionCatalogPageOptions,
): Promise<VisibleSectionCatalogEntry[]> {
  const result = await loadVisibleSectionCatalogPage(
    globalOrder,
    user,
    options,
    page,
  );
  return result.entries;
}

export async function loadVisibleSectionCatalogPage(
  globalOrder: readonly EpisodePartForAdaptiveOrder[],
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
  page?: VisibleSectionCatalogPageOptions,
): Promise<VisibleSectionCatalogPageResult<SectionPartForLearningUnits>> {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const prefetch = await dashTime("prefetchCatalogBuildContext", () =>
    prefetchCatalogBuildContext(user),
  );

  // Batch once: catalog binary-search + multi-section walk used to call
  // extendProgressMap/listProgressSlice dozens of times (N+1). Warm the shared
  // map with every curriculum part id up front; later beforeUnitsBuild no-ops.
  if (user && prefetch.prefetchedProgressMap && globalOrder.length > 0) {
    await prefetchAllProgressForCatalog(
      user,
      globalOrder.map((part) => part.id),
      prefetch.prefetchedProgressMap,
    );
  }

  const buildOptions = catalogBuildOptions(user, prefetch, options);
  return dashTime("computeVisibleSectionCatalog", () =>
    computeVisibleSectionCatalog(
      globalOrder,
      hydrateLearningMetaByIds,
      user,
      buildOptions,
      page,
    ),
  );
}

export async function buildSectionPlaylistForIndex(
  globalOrder: readonly EpisodePartForAdaptiveOrder[],
  sectionIndex: number,
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<VisibleSectionPlaylistResult<SectionPartForLearningUnits>> {
  const catalog = await loadVisibleSectionCatalog(
    globalOrder,
    user,
    options,
    { sectionLimit: sectionIndex },
  );
  const entry = catalog[sectionIndex - 1];
  if (!entry) {
    return {
      atomicParts: [],
      learningUnits: [],
      progressionUnits: [],
      globalStartIndex: 0,
      atomicPartCount: 0,
    };
  }
  return {
    atomicParts: entry.atomicParts,
    learningUnits: entry.learningUnits,
    progressionUnits: entry.progressionUnits,
    globalStartIndex: entry.globalStartIndex,
    atomicPartCount: entry.atomicPartCount,
    replayMergeEligible: entry.replayMergeEligible,
  };
}

export async function getOrMaterializeProgressionSection(params: {
  progressionScope: ProgressionSectionScope;
  sectionIndex: number;
  user: AdaptiveOrderUser | null;
  totalParts: number;
  options?: BuildSectionLearningUnitsOptions;
  mode?: ProgressionSectionLoadMode;
}): Promise<VisibleSectionPlaylistResult<SectionPartForLearningUnits>> {
  const {
    progressionScope,
    sectionIndex,
    user,
    totalParts,
    options,
    mode = "get-or-create",
  } = params;

  if (!user || mode === "dynamic") {
    const globalOrder = await loadCurriculumGlobalOrder(
      progressionScope.scope,
      user,
      totalParts,
    );
    return buildSectionPlaylistForIndex(globalOrder, sectionIndex, user, options);
  }

  const forceAtomicUnits =
    options?.forceAtomicUnits ?? LEARNER_FORCE_ATOMIC_UNITS;

  const existing = await loadExistingMaterializedPlaylist({
    ...progressionScope,
    userId: user.id,
    sectionIndex,
  });
  // After destructive parts rebuild, headers can survive while child part rows CASCADE away.
  // Treat empty blueprints as missing so we rematerialize against current parts.
  // Merged-unit blueprints from the old skill-merge policy are also stale under
  // LEARNER_FORCE_ATOMIC_UNITS — drop that section header only, then rematerialize.
  if (existing && existing.atomicPartCount > 0) {
    if (
      forceAtomicUnits &&
      playlistHasMergedLearningUnits(existing)
    ) {
      const stale = await findMaterializedSectionHeader({
        userId: user.id,
        sectionIndex,
        ...scopeIds(progressionScope),
      });
      if (stale) {
        await deleteMaterializedSectionById(stale.id);
      }
    } else {
      return existing;
    }
  }
  if (existing && existing.atomicPartCount === 0) {
    const hollow = await findMaterializedSectionHeader({
      userId: user.id,
      sectionIndex,
      ...scopeIds(progressionScope),
    });
    if (hollow) {
      await deleteMaterializedSectionById(hollow.id);
    }
  }

  if (mode === "read-only") {
    const globalOrder = await loadCurriculumGlobalOrder(
      progressionScope.scope,
      user,
      totalParts,
    );
    return buildSectionPlaylistForIndex(globalOrder, sectionIndex, user, options);
  }

  const curriculumVersion = await resolveCurriculumVersion(progressionScope.scope);
  const globalOrder = await loadCurriculumGlobalOrder(
    progressionScope.scope,
    user,
    totalParts,
  );
  const headers = await listMaterializedSectionHeaders({
    userId: user.id,
    ...scopeIds(progressionScope),
  });
  const priorHeaders = headers.filter((row) => row.sectionIndex < sectionIndex);
  const ownedIds = new Set<string>();
  for (const header of priorHeaders) {
    const blueprint = await loadMaterializedSectionBlueprint(header.id);
    if (!blueprint) continue;
    for (const row of blueprint.atomicParts) {
      ownedIds.add(row.partId);
    }
  }

  const filteredOrder = globalOrder.filter((part) => !ownedIds.has(part.id));
  const relativeSectionIndex = Math.max(1, sectionIndex - priorHeaders.length);
  const candidate = await buildSectionPlaylistForIndex(
    filteredOrder,
    relativeSectionIndex,
    user,
    options,
  );

  if (candidate.atomicParts.length === 0) {
    return candidate;
  }

  const persisted = await createMaterializedSectionBlueprint({
    userId: user.id,
    sectionIndex,
    curriculumVersion,
    ...scopeIds(progressionScope),
    globalStartIndex: null,
    globalEndIndexExclusive: null,
    atomicPartIds: candidate.atomicParts.map((part) => part.id),
    learningUnitPartIds: unitPartIdsFromLearningUnits(candidate.learningUnits),
    progressionUnitPartIds: unitPartIdsFromLearningUnits(
      candidate.progressionUnits.length > 0
        ? candidate.progressionUnits
        : candidate.learningUnits,
    ),
  });
  if (persisted) {
    const hydrated = await hydrateMaterializedPlaylist(persisted.header.id);
    if (hydrated) return hydrated;
  }

  const winner = await loadExistingMaterializedPlaylist({
    ...progressionScope,
    userId: user.id,
    sectionIndex,
  });
  if (winner) return winner;

  return candidate;
}

export async function countVisibleSections(
  globalOrder: readonly EpisodePartForAdaptiveOrder[],
  user: AdaptiveOrderUser | null,
  options?: BuildSectionLearningUnitsOptions,
): Promise<number> {
  const catalog = await loadVisibleSectionCatalog(
    globalOrder,
    user,
    options,
  );
  return Math.max(1, catalog.length);
}

function progressionUnitsForEntry(entry: {
  progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
}): ReadonlyArray<LearningUnit<SectionPartForLearningUnits>> {
  return entry.progressionUnits ?? entry.learningUnits;
}

/** Locate the visible section index that owns a part in a pre-built catalog. */
export function resolveVisibleSectionIndexInCatalog(
  catalog: ReadonlyArray<{
    sectionIndex: number;
    atomicParts: ReadonlyArray<{ id: string }>;
  }>,
  partId: string,
): number | null {
  for (const entry of catalog) {
    if (entry.atomicParts.some((part) => part.id === partId)) {
      return entry.sectionIndex;
    }
  }
  return null;
}

/** Resolve visible section index for a part (user-specific adaptive catalog). */
export async function resolveVisibleSectionIndexForPart(
  scope: SectionCurriculumScope,
  partId: string,
  user: AdaptiveOrderUser | null,
  totalParts: number,
): Promise<number | null> {
  const globalOrder = await loadCurriculumGlobalOrder(scope, user, totalParts);
  const catalog = await loadVisibleSectionCatalog(globalOrder, user);
  return resolveVisibleSectionIndexInCatalog(catalog, partId);
}

/** 1-based visible learning-unit step within a section entry (progression boundaries). */
export function resolveVisibleUnitStepInSectionEntry(
  entry: {
    progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  },
  partId: string,
): number | null {
  const units = progressionUnitsForEntry(entry).slice(
    0,
    VISIBLE_UNITS_PER_SECTION,
  );
  for (let i = 0; i < units.length; i++) {
    if (units[i]!.parts.some((part) => part.id === partId)) {
      return i + 1;
    }
  }
  return null;
}

/** 1-based session step from the playback playlist (matches the learn page). */
export function resolveVisibleUnitStepInPlaybackEntry(
  entry: {
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  },
  partId: string,
): number | null {
  const units = entry.learningUnits.slice(0, VISIBLE_UNITS_PER_SECTION);
  for (let i = 0; i < units.length; i++) {
    if (units[i]!.parts.some((part) => part.id === partId)) {
      return i + 1;
    }
  }
  return null;
}

/** Session section + unit for a part — prefers later sections and playback units. */
export function resolveVisiblePlacementInCatalog(
  catalog: ReadonlyArray<{
    sectionIndex: number;
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  }>,
  partId: string,
): { sectionIndex: number; visibleUnitStep: number } | null {
  const bySectionDesc = [...catalog].sort(
    (a, b) => b.sectionIndex - a.sectionIndex,
  );
  for (const entry of bySectionDesc) {
    const visibleUnitStep = resolveVisibleUnitStepInPlaybackEntry(entry, partId);
    if (visibleUnitStep != null) {
      return { sectionIndex: entry.sectionIndex, visibleUnitStep };
    }
  }
  return null;
}

/** Adaptive section + visible unit step for a completed clip. */
export async function resolveVisibleSectionAndUnitForPart(
  scope: SectionCurriculumScope,
  partId: string,
  user: AdaptiveOrderUser | null,
  totalParts: number,
): Promise<{ sectionIndex: number; visibleUnitStep: number } | null> {
  const globalOrder = await loadCurriculumGlobalOrder(scope, user, totalParts);
  const catalog = await loadVisibleSectionCatalog(globalOrder, user);
  return resolveVisiblePlacementInCatalog(catalog, partId);
}

/** Batch-evaluate visible-unit completion for a catalog (one progress query). */
export async function evaluateCatalogVisibleCompletion(
  catalog: ReadonlyArray<{
    progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  }>,
  userId: string | null,
): Promise<boolean[]> {
  if (!userId || catalog.length === 0) {
    return catalog.map(() => false);
  }

  const partIds = catalog.flatMap((entry) =>
    progressionUnitsForEntry(entry).flatMap((unit) =>
      unit.parts.map((part) => part.id),
    ),
  );
  const slices = await listProgressSliceForParts(userId, partIds);
  const progressMap = new Map(
    slices.map((slice) => [
      slice.partId,
      {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
      },
    ]),
  );

  return catalog.map((entry) => {
    const unitsWithProgress = progressionUnitsForEntry(entry).map((unit) => ({
      ...unit,
      parts: unit.parts.map((part) => ({
        ...part,
        speechDurationMs: resolveSpeechDurationMs(part),
        progress: progressMap.get(part.id) ?? null,
      })),
    }));
    return isSectionVisuallyComplete(unitsWithProgress);
  });
}

/** Load progress and evaluate visible-unit completion for a section playlist. */
export async function evaluateSectionVisibleCompletion(
  units: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>,
  userId: string | null,
  opts?: {
    /** When set, evaluate the standard visible units (not replay-merged playback). */
    progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  },
): Promise<{
  completedUnitCount: number;
  isComplete: boolean;
}> {
  const unitsToEvaluate = opts?.progressionUnits ?? units;
  const partIds = unitsToEvaluate.flatMap((unit) =>
    unit.parts.map((part) => part.id),
  );
  const progressMap = new Map<
    string,
    {
      bestScore: number;
      completedAt: Date | null;
      attempts: number;
      wrongMoves: number;
    } | null
  >();

  if (userId && partIds.length > 0) {
    const slices = await listProgressSliceForParts(userId, partIds);
    for (const slice of slices) {
      progressMap.set(slice.partId, {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
      });
    }
  }

  const unitsWithProgress = unitsToEvaluate.map((unit) => ({
    ...unit,
    parts: unit.parts.map((part) => ({
      ...part,
      speechDurationMs: resolveSpeechDurationMs(part),
      progress: progressMap.get(part.id) ?? null,
    })),
  }));

  const completedUnitCount = countCompletedVisibleUnits(unitsWithProgress);
  const isComplete = isSectionVisuallyComplete(unitsWithProgress);

  return { completedUnitCount, isComplete };
}

/** Load progress and evaluate unlock completion for a section (session-scoped). */
export async function evaluateSectionUnlockCompletion(
  entry: {
    sectionIndex: number;
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
    progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  },
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;

  const units = entry.progressionUnits ?? entry.learningUnits;
  const partIds = units.flatMap((unit) => unit.parts.map((part) => part.id));
  const slices = await listProgressSliceForParts(userId, partIds);
  const progressMap = new Map<string, SectionUnlockProgressSlice | null>(
    slices.map((slice) => [
      slice.partId,
      {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
        sessionSectionIndex: slice.sessionSectionIndex,
      },
    ]),
  );

  return isCatalogEntryUnlockCompleteSync(
    {
      sectionIndex: entry.sectionIndex,
      learningUnits: entry.learningUnits,
      progressionUnits: entry.progressionUnits,
    },
    progressMap,
  );
}

/**
 * Section unlock / next-section CTA — true when every learner-visible step
 * in fixed progression boundaries is qualified-complete in this section session.
 */
export async function isSectionCompleteForUnlock(
  entry: {
    sectionIndex: number;
    learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
    progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  },
  userId: string | null,
): Promise<boolean> {
  return evaluateSectionUnlockCompletion(entry, userId);
}

type SectionCatalogEntry = {
  sectionIndex?: number;
  atomicParts?: ReadonlyArray<{ id: string }>;
  learningUnits: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
  progressionUnits?: ReadonlyArray<LearningUnit<SectionPartForLearningUnits>>;
};

function lastVisiblePlaybackUnit(
  entry: SectionCatalogEntry,
): LearningUnit<SectionPartForLearningUnits> | null {
  const units = entry.learningUnits.slice(0, VISIBLE_UNITS_PER_SECTION);
  if (units.length === 0) return null;
  return units[VISIBLE_UNITS_PER_SECTION - 1] ?? units[units.length - 1] ?? null;
}

/**
 * Finished the section session — all visible units qualified, or the learner
 * reached the last playback step with a scored completion (summary eligible).
 *
 * Unlock must use learner-visible units, never canonical order and never a
 * raw atomic-part headcount (merged units would unlock early).
 */
export async function isSectionSessionFinished(
  entry: SectionCatalogEntry,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  if (
    entry.sectionIndex != null &&
    (await isSectionCompleteForUnlock(
      {
        sectionIndex: entry.sectionIndex,
        learningUnits: entry.learningUnits,
        progressionUnits: entry.progressionUnits,
      },
      userId,
    ))
  ) {
    return true;
  }

  const [playback] = await Promise.all([
    evaluateSectionVisibleCompletion(entry.learningUnits, userId),
  ]);
  if (playback.isComplete) return true;

  const lastUnit = lastVisiblePlaybackUnit(entry);
  if (!lastUnit) return false;

  const partIds = lastUnit.parts.map((part) => part.id);
  const slices = await listProgressSliceForParts(userId, partIds);
  const byPart = new Map(slices.map((row) => [row.partId, row]));
  return partIds.every((partId) => {
    const row = byPart.get(partId);
    return row?.completedAt != null && (row.bestScore ?? 0) > 0;
  });
}

/** Batch unlock completion — session-scoped progression units, one progress query. */
export async function evaluateCatalogUnlockCompletion(
  catalog: ReadonlyArray<
    SectionCatalogEntry & { sectionIndex: number }
  >,
  userId: string | null,
): Promise<boolean[]> {
  if (!userId || catalog.length === 0) {
    return catalog.map(() => false);
  }

  const partIds = catalog.flatMap((entry) =>
    progressionUnitsForEntry(entry).flatMap((unit) =>
      unit.parts.map((part) => part.id),
    ),
  );
  const slices = await listProgressSliceForParts(userId, partIds);
  const progressMap = new Map<string, SectionUnlockProgressSlice | null>(
    slices.map((slice) => [
      slice.partId,
      {
        bestScore: slice.bestScore,
        completedAt: slice.completedAt,
        attempts: slice.attempts,
        wrongMoves: slice.wrongMoves,
        sessionSectionIndex: slice.sessionSectionIndex,
      },
    ]),
  );

  return catalog.map((entry) =>
    isCatalogEntryUnlockCompleteSync(entry, progressMap),
  );
}

/** Hydrate a visible-section playlist into full part rows for the player. */
export async function hydrateVisibleSectionUnits<
  T extends SectionPartForLearningUnits,
>(
  playlist: {
    atomicParts: readonly T[];
    learningUnits: ReadonlyArray<LearningUnit<T>>;
  },
): Promise<{
  orderedParts: Array<Part & { translations: unknown[] }>;
  learningUnits: LearningUnit<Part & { translations: unknown[] }>[];
  progressionUnits: LearningUnit<Part & { translations: unknown[] }>[];
}> {
  const orderedParts = await hydrateSectionPartsFromOrderMeta(
    playlist.atomicParts,
  );
  const mapUnitParts = (
    unit: LearningUnit<(typeof playlist.atomicParts)[number]>,
  ) => ({
    ...unit,
    parts: unit.parts
      .map((atomic) => orderedParts.find((p) => p.id === atomic.id))
      .filter((p): p is (typeof orderedParts)[number] => p != null),
  });
  const learningUnits = playlist.learningUnits.map(mapUnitParts);
  const progressionUnits = (
    playlist.progressionUnits.length > 0
      ? playlist.progressionUnits
      : playlist.learningUnits
  ).map(mapUnitParts);

  return { orderedParts, learningUnits, progressionUnits };
}
