import {
  getUserLastPositionForEpisode,
  getUserLastPositionForStandalone,
} from "@/lib/db/lastSeen";
import {
  listMaterializedSectionHeaders,
  loadMaterializedSectionBlueprint,
} from "@/lib/db/queries/userMaterializedSections";
import {
  countPartsForEpisode,
  countPartsForVideo,
} from "@/lib/db/sectionProgress";
import { getUserById } from "@/lib/db/queries/users";
import {
  resolveVisibleSectionAndUnitForPart,
  type SectionCurriculumScope,
} from "@/lib/learning/sectionCurriculum";
import { resolveBookmarkResumePlacement } from "@/lib/learning/resolveBookmarkResumePlacement";
import {
  bookmarkOrderForVisibleStep,
  visibleStepFromBookmarkOrder,
} from "@/lib/learning/sectionResume";
import { dashTime } from "@/lib/debug/dashboardTiming";
import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";

export type LearnerVisiblePlacement = {
  sectionIndex: number;
  visibleUnitStep: number;
  /** Encoded section/step order — used for coarse progress estimates. */
  bookmarkOrder: number;
};

/**
 * Map a catalog part to the learner-facing section + visible step.
 * Prefers UI bookmarks for resume surfaces; otherwise walks the adaptive catalog.
 */
export async function resolveLearnerVisiblePlacement(params: {
  userId: UserId;
  rootVideoId: string;
  rootVideoType: VideoType;
  episodeId: string | null;
  partId: string;
  atomicOrder: number;
  /** Resume surfaces (dashboard continue) should match the sections-page bookmark. */
  preferBookmark?: boolean;
}): Promise<LearnerVisiblePlacement> {
  const {
    userId,
    rootVideoId,
    rootVideoType,
    episodeId,
    partId,
    atomicOrder,
    preferBookmark = false,
  } = params;

  const isSeries = rootVideoType === "series";

  if (preferBookmark) {
    const bookmark = await dashTime(
      isSeries && episodeId
        ? "getUserLastPositionForEpisode"
        : "getUserLastPositionForStandalone",
      () =>
        isSeries && episodeId
          ? getUserLastPositionForEpisode(userId, rootVideoId, episodeId)
          : getUserLastPositionForStandalone(userId, rootVideoId),
    );
    if (bookmark) {
      return dashTime("resolveBookmarkResumePlacement", () =>
        resolveBookmarkResumePlacement({
          userId,
          bookmark,
          rootVideoId,
          rootVideoType,
          episodeId,
        }),
      );
    }
  }

  const scope: SectionCurriculumScope | null =
    isSeries && episodeId
      ? { episodeId, curriculumId: `episode:${episodeId}` }
      : { videoId: rootVideoId, curriculumId: `video:${rootVideoId}` };

  if (scope) {
    const headers = await listMaterializedSectionHeaders({
      userId,
      videoId: rootVideoId,
      episodeId: isSeries ? episodeId : null,
      scopeKey:
        isSeries && episodeId
          ? `episode:${episodeId}`
          : `video:${rootVideoId}`,
    });
    for (const header of headers) {
      const blueprint = await loadMaterializedSectionBlueprint(header.id);
      if (!blueprint) continue;
      const hit = blueprint.learningUnitParts.find((row) => row.partId === partId);
      if (hit) {
        const placement = {
          sectionIndex: header.sectionIndex,
          visibleUnitStep: hit.unitIndex,
          bookmarkOrder: bookmarkOrderForVisibleStep(
            header.sectionIndex,
            hit.unitIndex,
          ),
        };
        if (preferBookmark) {
          return dashTime("resolveBookmarkResumePlacement(materialized)", () =>
            resolveBookmarkResumePlacement({
              userId,
              bookmark: {
                sectionIndex: placement.sectionIndex,
                visibleUnitStep: placement.visibleUnitStep,
              },
              rootVideoId,
              rootVideoType,
              episodeId,
            }),
          );
        }
        return placement;
      }
    }

    const totalParts = await dashTime("countParts(forPlacement)", () =>
      isSeries && episodeId
        ? countPartsForEpisode(episodeId)
        : countPartsForVideo(rootVideoId),
    );

    if (totalParts > 0) {
      const user = await dashTime("getUserById", () => getUserById(userId));
      const adaptiveUser = user
        ? { id: userId, englishLevel: user.englishLevel }
        : null;
      const placement = await dashTime(
        "resolveVisibleSectionAndUnitForPart",
        () =>
          resolveVisibleSectionAndUnitForPart(
            scope,
            partId,
            adaptiveUser,
            totalParts,
          ),
      );
      if (placement) {
        if (preferBookmark) {
          return dashTime("resolveBookmarkResumePlacement(fromPart)", () =>
            resolveBookmarkResumePlacement({
              userId,
              bookmark: {
                sectionIndex: placement.sectionIndex,
                visibleUnitStep: placement.visibleUnitStep,
              },
              rootVideoId,
              rootVideoType,
              episodeId,
            }),
          );
        }
        return {
          sectionIndex: placement.sectionIndex,
          visibleUnitStep: placement.visibleUnitStep,
          bookmarkOrder: bookmarkOrderForVisibleStep(
            placement.sectionIndex,
            placement.visibleUnitStep,
          ),
        };
      }
    }
  }

  const decoded = visibleStepFromBookmarkOrder(atomicOrder);
  if (preferBookmark) {
    return dashTime("resolveBookmarkResumePlacement(fromAtomicOrder)", () =>
      resolveBookmarkResumePlacement({
        userId,
        bookmark: {
          sectionIndex: decoded.sectionIndex,
          visibleUnitStep: decoded.visibleUnitStep,
        },
        rootVideoId,
        rootVideoType,
        episodeId,
      }),
    );
  }
  return {
    sectionIndex: decoded.sectionIndex,
    visibleUnitStep: decoded.visibleUnitStep,
    bookmarkOrder: atomicOrder,
  };
}
