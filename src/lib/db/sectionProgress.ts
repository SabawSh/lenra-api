import type { UserId } from "@/types/schema";
import { EPISODE_SECTIONS_PAGE_BATCH } from "@/lib/learning/episodeSectionsBatch";
import { nextSectionBatchSize } from "@/lib/learning/episodeSectionsShell";
import {
  sectionOrderBounds,
  totalSectionsForParts,
  VISIBLE_UNITS_PER_SECTION,
} from "@/lib/learning/sections";
import { isSectionContentAccessible } from "@/lib/learning/sectionAccessPolicy";
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import * as vq from "@/lib/db/queries/videos";
import { unstable_cache } from "next/cache";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  getOrMaterializeProgressionSection,
  isSectionCompleteForUnlock,
  loadCurriculumGlobalOrder,
  loadVisibleSectionCatalogPage,
  type SectionCurriculumScope,
} from "@/lib/learning/sectionCurriculum";
import { resolveStoredUnlockState } from "@/lib/learning/resolveUnlockFrontier";
import { logSectionTransition } from "@/lib/debug/sectionTransitionTrace";
import { getUserById } from "@/lib/db/queries/users";

export const USER_PROGRESS_CACHE_TAG = "user-progress";

export const countPartsForEpisode = unstable_cache(
  async (episodeId: string): Promise<number> =>
    vq.countPartsForEpisodeId(episodeId),
  ["count-parts-for-episode"],
  { revalidate: 864000, tags: ["episodes"] },
);

export const countPartsForVideo = unstable_cache(
  async (videoId: string): Promise<number> =>
    vq.countPartsForVideoId(videoId),
  ["count-parts-for-video"],
  { revalidate: 864000, tags: ["videos"] },
);

type SectionScope = {
  userId: UserId | null;
  sectionIndex: number;
  totalParts: number;
  episodeId?: string;
  videoId?: string;
};

function partScopeIds(scope: Pick<SectionScope, "episodeId" | "videoId">) {
  return {
    ...(scope.episodeId != null ? { episodeId: scope.episodeId } : {}),
    ...(scope.videoId != null ? { videoId: scope.videoId } : {}),
  };
}

function curriculumScope(
  scope: Pick<SectionScope, "episodeId" | "videoId">,
): SectionCurriculumScope | null {
  if (scope.episodeId != null) {
    return {
      episodeId: scope.episodeId,
      curriculumId: `episode:${scope.episodeId}`,
    };
  }
  if (scope.videoId != null) {
    return {
      videoId: scope.videoId,
      curriculumId: `video:${scope.videoId}`,
    };
  }
  return null;
}

async function resolveAdaptiveOrderUser(
  userId: UserId | null,
): Promise<AdaptiveOrderUser | null> {
  if (!userId) return null;
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const user = await dashTime("SQL getUserById(adaptive)", () =>
    getUserById(userId),
  );
  if (!user) return null;
  return { id: userId, englishLevel: user.englishLevel };
}

async function loadCatalogForScope(
  scope: SectionCurriculumScope,
  userId: UserId | null,
  totalParts: number,
  page?: {
    startSectionIndex?: number;
    sectionLimit?: number;
    stopAtFirstIncomplete?: boolean;
  },
) {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const user = await dashTime("resolveAdaptiveOrderUser", () =>
    resolveAdaptiveOrderUser(userId),
  );
  const globalOrder = await dashTime("loadCurriculumGlobalOrder", () =>
    loadCurriculumGlobalOrder(scope, user, totalParts),
  );
  const catalogPage = await dashTime("loadVisibleSectionCatalogPage", () =>
    loadVisibleSectionCatalogPage(globalOrder, user, undefined, page),
  );
  return {
    user,
    globalOrder,
    catalog: catalogPage.entries,
    hasMoreSections: catalogPage.hasMoreSections,
    unlockFrontierSection: catalogPage.unlockFrontierSection,
  };
}

/**
 * Fresh DB read — do not cache (user progress changes every clip).
 *
 * Content access: any section index ≥ 1 is open (see sectionAccessPolicy).
 * `highestUnlockedSection` remains progress metadata for resume/Continue
 * Learning — it must NOT gate navigation.
 */
export async function isSectionUnlockedForUser({
  userId: _userId,
  sectionIndex,
  totalParts: _totalParts,
  episodeId: _episodeId,
  videoId: _videoId,
}: SectionScope): Promise<boolean> {
  const accessible = isSectionContentAccessible(sectionIndex);
  logSectionTransition({
    phase: "isSectionUnlockedForUser",
    requestedSectionIndex: sectionIndex,
    unlocked: accessible,
  });
  return accessible;
}

/** Highest playable unlocked section from user_learning_resume (always ≥ 1). */
export async function findHighestUnlockedSectionIndex(
  params: Omit<SectionScope, "sectionIndex">,
): Promise<number> {
  if (!params.userId) return 1;

  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  return dashTime("findHighestUnlockedSectionIndex.body", async () => {
    const { highestUnlockedSection } = await resolveStoredUnlockState({
      userId: params.userId,
      videoId: params.videoId,
      logScope: "findHighestUnlockedSectionIndex",
    });
    return highestUnlockedSection;
  });
}

export type EpisodeSectionUnlockRow = {
  sectionIndex: number;
  unlocked: boolean;
  clipCount: number;
};

type SectionUnlockScope = {
  userId: UserId | null;
  totalParts: number;
  episodeId?: string;
  videoId?: string;
  /** First section index to return (default 1). */
  startSectionIndex?: number;
  /** Max sections in this page (default: all remaining). */
  sectionLimit?: number;
};

export type SectionUnlockPageResult = {
  rows: EpisodeSectionUnlockRow[];
  hasMoreSections: boolean;
};

function unlockRowsFromCatalog(
  catalog: Awaited<
    ReturnType<typeof loadVisibleSectionCatalogPage>
  >["entries"],
  _highestUnlockedSection: number,
  _userId: UserId | null,
): EpisodeSectionUnlockRow[] {
  return catalog.map((entry) => ({
    sectionIndex: entry.sectionIndex,
    // Content access is unrestricted — progress is tracked separately.
    unlocked: isSectionContentAccessible(entry.sectionIndex),
    clipCount: VISIBLE_UNITS_PER_SECTION,
  }));
}

/** Batch unlock rows — catalog for section shells; unlock from learning_resume only. */
export async function getSectionUnlockRows({
  userId,
  totalParts,
  episodeId,
  videoId,
  startSectionIndex = 1,
  sectionLimit,
}: SectionUnlockScope): Promise<SectionUnlockPageResult> {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  return dashTime(
    `getSectionUnlockRows(start=${startSectionIndex},limit=${sectionLimit ?? "all"})`,
    async () => {
      const scope = curriculumScope({ episodeId, videoId });
      if (!scope) return { rows: [], hasMoreSections: false };

      const limit = sectionLimit ?? Number.POSITIVE_INFINITY;
      const estimatedTotal = totalSectionsForParts(totalParts);

      // Paginated batch grid (page 2+): shells + part progress only — skip walking
      // sections 1..N-1 through the adaptive catalog on every click.
      if (
        startSectionIndex > 1 &&
        Number.isFinite(limit) &&
        limit > 0 &&
        limit <= EPISODE_SECTIONS_PAGE_BATCH
      ) {
        const batchSize = nextSectionBatchSize(
          startSectionIndex,
          estimatedTotal,
          limit,
        );
        if (batchSize > 0) {
          const rows = Array.from({ length: batchSize }, (_, i) => {
            const sectionIndex = startSectionIndex + i;
            return {
              sectionIndex,
              unlocked: isSectionContentAccessible(sectionIndex),
              clipCount: VISIBLE_UNITS_PER_SECTION,
            };
          });
          return {
            rows,
            hasMoreSections: startSectionIndex + batchSize - 1 < estimatedTotal,
          };
        }
      }

      // Unlock is stored state — never catalog completion or resumeSection.
      const unlockState = await resolveStoredUnlockState({
        userId,
        videoId,
        logScope: `getSectionUnlockRows(start=${startSectionIndex})`,
      });
      const highestUnlockedSection = unlockState.highestUnlockedSection;

      // Catalog walk builds section shells only. Do not stop at incomplete —
      // unlock status comes from highestUnlockedSection, not progress proof.
      const { catalog, hasMoreSections } = await dashTime(
        "loadCatalogForScope(unlockPage)",
        () =>
          loadCatalogForScope(scope, userId, totalParts, {
            startSectionIndex,
            sectionLimit: limit,
            stopAtFirstIncomplete: false,
          }),
      );
      if (catalog.length === 0) {
        if (
          startSectionIndex <= estimatedTotal &&
          Number.isFinite(limit) &&
          limit > 0
        ) {
          const batchSize = nextSectionBatchSize(
            startSectionIndex,
            estimatedTotal,
            limit,
          );
          if (batchSize > 0) {
            const placeholderRows = Array.from(
              { length: batchSize },
              (_, i) => {
                const sectionIndex = startSectionIndex + i;
                return {
                  sectionIndex,
                  unlocked: isSectionContentAccessible(sectionIndex),
                  clipCount: VISIBLE_UNITS_PER_SECTION,
                };
              },
            );
            return {
              rows: placeholderRows,
              hasMoreSections:
                startSectionIndex + batchSize - 1 < estimatedTotal,
            };
          }
        }
        return { rows: [], hasMoreSections: false };
      }

      const rows = unlockRowsFromCatalog(
        catalog,
        highestUnlockedSection,
        userId,
      );

      if (process.env.DEBUG_SECTION_UNLOCK === "1") {
        const { logStoredUnlockState } = await import(
          "@/lib/learning/resolveUnlockFrontier"
        );
        const highestRenderedUnlocked = rows.reduce(
          (max, row) =>
            row.unlocked && row.sectionIndex > max ? row.sectionIndex : max,
          1,
        );
        logStoredUnlockState("getSectionUnlockRows(rendered)", {
          ...unlockState,
          highestRenderedUnlockedSection: highestRenderedUnlocked,
        });
      }

      // Pad only as LOCKED placeholders for the requested page window.
      const pageEnd =
        Number.isFinite(limit) && limit > 0
          ? startSectionIndex + limit - 1
          : null;
      if (pageEnd != null && rows.length > 0) {
        const lastIndex = rows[rows.length - 1]!.sectionIndex;
        for (let s = lastIndex + 1; s <= pageEnd; s++) {
          rows.push({
            sectionIndex: s,
            unlocked: isSectionContentAccessible(s),
            clipCount: VISIBLE_UNITS_PER_SECTION,
          });
        }
      }

      return {
        rows,
        hasMoreSections,
      };
    },
  );
}

/** @deprecated Prefer paginated `getSectionUnlockRows` — loads one page at a time. */
export async function getSectionUnlockRowsAll({
  userId,
  totalParts,
  episodeId,
  videoId,
}: Omit<SectionUnlockScope, "startSectionIndex" | "sectionLimit">): Promise<
  EpisodeSectionUnlockRow[]
> {
  const all: EpisodeSectionUnlockRow[] = [];
  let startSectionIndex = 1;
  for (;;) {
    const page = await getSectionUnlockRows({
      userId,
      totalParts,
      episodeId,
      videoId,
      startSectionIndex,
      sectionLimit: 50,
    });
    all.push(...page.rows);
    if (!page.hasMoreSections) break;
    startSectionIndex += page.rows.length;
  }
  return all;
}

export async function getEpisodeSectionUnlockRows({
  userId,
  episodeId,
  videoId,
  totalParts,
  startSectionIndex,
  sectionLimit,
}: {
  userId: UserId | null;
  episodeId: string;
  /** Series root video id — required to merge with user_learning_resume. */
  videoId?: string;
  totalParts: number;
  startSectionIndex?: number;
  sectionLimit?: number;
}): Promise<SectionUnlockPageResult> {
  return getSectionUnlockRows({
    userId,
    episodeId,
    videoId,
    totalParts,
    startSectionIndex,
    sectionLimit,
  });
}

export async function getVideoSectionUnlockRows({
  userId,
  videoId,
  totalParts,
  startSectionIndex,
  sectionLimit,
}: {
  userId: UserId | null;
  videoId: string;
  totalParts: number;
  startSectionIndex?: number;
  sectionLimit?: number;
}): Promise<SectionUnlockPageResult> {
  return getSectionUnlockRows({
    userId,
    videoId,
    totalParts,
    startSectionIndex,
    sectionLimit,
  });
}

/** Unlock + adaptive first-clip story order for a set of section indices (lazy catalog walk). */
export async function getSectionClipHintsForIndices({
  userId,
  totalParts,
  episodeId,
  videoId,
  sectionIndices,
}: {
  userId: UserId | null;
  totalParts: number;
  episodeId?: string;
  videoId?: string;
  sectionIndices: readonly number[];
}): Promise<{
  unlockBySection: Map<number, boolean>;
  firstPartOrderBySection: Map<number, number>;
}> {
  const unlockBySection = new Map<number, boolean>();
  const firstPartOrderBySection = new Map<number, number>();
  for (const sectionIndex of sectionIndices) {
    unlockBySection.set(sectionIndex, false);
  }
  if (sectionIndices.length === 0) {
    return { unlockBySection, firstPartOrderBySection };
  }

  const maxSection = Math.max(...sectionIndices);
  const scope = curriculumScope({ episodeId, videoId });
  if (!scope) return { unlockBySection, firstPartOrderBySection };

  const { catalog } = await loadCatalogForScope(
    scope,
    userId,
    totalParts,
    {
      startSectionIndex: 1,
      sectionLimit: maxSection,
      stopAtFirstIncomplete: false,
    },
  );
  if (catalog.length === 0) {
    return { unlockBySection, firstPartOrderBySection };
  }

  const { highestUnlockedSection } = await resolveStoredUnlockState({
    userId,
    videoId,
    logScope: "getSectionClipHintsForIndices",
  });

  const rows = unlockRowsFromCatalog(catalog, highestUnlockedSection, userId);
  for (const row of rows) {
    unlockBySection.set(row.sectionIndex, row.unlocked);
  }

  for (const entry of catalog) {
    if (!sectionIndices.includes(entry.sectionIndex)) continue;
    const firstPart = entry.atomicParts[0];
    if (firstPart) {
      firstPartOrderBySection.set(entry.sectionIndex, firstPart.order);
    }
  }

  return { unlockBySection, firstPartOrderBySection };
}

export type SectionPartProgressRow = {
  order: number;
  bestScore: number;
  lastScore: number;
  completedAt: Date | null;
  /** User has at least one saved attempt on this part. */
  attempted: boolean;
  wrongMoves: number;
  attempts: number;
  lastSentenceInputMode: "drag" | "voice" | null;
  accuracy: number | null;
  speed: number | null;
  /** Cumulative XP awarded for this clip. */
  xpEarned: number;
};

function emptySectionPartProgressRow(order: number): SectionPartProgressRow {
  return {
    order,
    bestScore: 0,
    lastScore: 0,
    completedAt: null,
    attempted: false,
    wrongMoves: 0,
    attempts: 0,
    lastSentenceInputMode: null,
    accuracy: null,
    speed: null,
    xpEarned: 0,
  };
}

function mapSectionPartProgressRow(
  order: number,
  row: Awaited<ReturnType<typeof listProgressSliceForParts>>[number] | undefined,
): SectionPartProgressRow {
  if (!row) return emptySectionPartProgressRow(order);
  return {
    order,
    bestScore: row.bestScore,
    lastScore: row.lastScore,
    completedAt: row.completedAt,
    attempted: true,
    wrongMoves: row.wrongMoves,
    attempts: row.attempts,
    lastSentenceInputMode: row.lastSentenceInputMode,
    accuracy: row.accuracy,
    speed: row.speed,
    xpEarned: row.xpEarned,
  };
}

export async function getSectionProgressRows({
  userId,
  sectionIndex,
  totalParts,
  episodeId,
  videoId,
}: SectionScope): Promise<SectionPartProgressRow[]> {
  const bounds = sectionOrderBounds(sectionIndex, totalParts);
  if (!bounds) return [];

  const parts = await vq.listPartIdsInOrderRange({
    ...partScopeIds({ episodeId, videoId }),
    orderGte: bounds.start,
    orderLte: bounds.end,
  });

  if (!userId || parts.length === 0) {
    return parts.map((p) => emptySectionPartProgressRow(p.order));
  }

  const prog = await listProgressSliceForParts(
    userId,
    parts.map((p) => p.id),
  );
  const byPart = new Map(prog.map((r) => [r.partId, r]));

  return parts.map((p) => mapSectionPartProgressRow(p.order, byPart.get(p.id)));
}

/** Progress for the clips in a visible-section catalog entry (adaptive playlist). */
export async function getSectionProgressRowsForPartIds(
  userId: UserId | null,
  parts: ReadonlyArray<{ id: string; order: number }>,
): Promise<SectionPartProgressRow[]> {
  if (parts.length === 0) return [];

  if (!userId) {
    return parts.map((p) => emptySectionPartProgressRow(p.order));
  }

  const prog = await listProgressSliceForParts(
    userId,
    parts.map((p) => p.id),
  );
  const byPart = new Map(prog.map((r) => [r.partId, r]));

  return parts.map((p) => mapSectionPartProgressRow(p.order, byPart.get(p.id)));
}

export async function hasCompletedSectionEnd({
  userId,
  sectionIndex,
  totalParts,
  episodeId,
  videoId,
}: SectionScope): Promise<boolean> {
  if (!userId) return true;

  const scope = curriculumScope({ episodeId, videoId });
  if (!scope) return false;

  const user = await resolveAdaptiveOrderUser(userId);
  const playlist = await getOrMaterializeProgressionSection({
    progressionScope: {
      scope,
      videoId: videoId ?? "",
      episodeId: episodeId ?? null,
    },
    sectionIndex,
    user,
    totalParts,
    mode: "read-only",
  });

  const progression =
    playlist.progressionUnits.length > 0
      ? playlist.progressionUnits
      : playlist.learningUnits;
  const lastUnit =
    progression[VISIBLE_UNITS_PER_SECTION - 1] ??
    progression[progression.length - 1];
  if (!lastUnit) return false;

  const partIds = lastUnit.parts.map((part) => part.id);
  const slices = await listProgressSliceForParts(userId, partIds);
  return slices.every(
    (row) => row.completedAt != null && (row.bestScore ?? 0) > 0,
  );
}

export async function isSectionFullyComplete({
  userId,
  sectionIndex,
  totalParts,
  episodeId,
  videoId,
}: SectionScope): Promise<boolean> {
  if (!userId) return false;

  const scope = curriculumScope({ episodeId, videoId });
  if (!scope) return false;

  const user = await resolveAdaptiveOrderUser(userId);
  const playlist = await getOrMaterializeProgressionSection({
    progressionScope: {
      scope,
      videoId: videoId ?? "",
      episodeId: episodeId ?? null,
    },
    sectionIndex,
    user,
    totalParts,
    mode: "read-only",
  });

  return isSectionCompleteForUnlock(
    {
      sectionIndex,
      learningUnits: playlist.learningUnits,
      progressionUnits: playlist.progressionUnits,
    },
    userId,
  );
}
