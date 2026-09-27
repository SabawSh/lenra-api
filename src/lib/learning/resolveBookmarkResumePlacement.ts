import {
  countPartsForEpisode,
  countPartsForVideo,
  findHighestUnlockedSectionIndex,
} from "@/lib/db/sectionProgress";
import {
  bookmarkOrderForVisibleStep,
  resolveSectionStartStep,
  type UserLastPosition,
} from "@/lib/learning/sectionResume";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import { dashTime } from "@/lib/debug/dashboardTiming";
import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";

export type BookmarkResumePlacement = {
  sectionIndex: number;
  visibleUnitStep: number;
  bookmarkOrder: number;
};

function placementFrom(
  sectionIndex: number,
  visibleUnitStep: number,
): BookmarkResumePlacement {
  const step = Math.max(
    1,
    Math.min(visibleUnitStep, VISIBLE_UNITS_PER_SECTION),
  );
  return {
    sectionIndex,
    visibleUnitStep: step,
    bookmarkOrder: bookmarkOrderForVisibleStep(sectionIndex, step),
  };
}

/**
 * Resume surfaces must agree with the sections-page unlock frontier.
 *
 * Cheap path: one frontier unlock walk (stop-at-incomplete), then clamp the
 * bookmark. Does NOT rebuild the full adaptive catalog — that made the
 * dashboard Continue Learning card take 20s+.
 */
export async function resolveBookmarkResumePlacement(params: {
  userId: UserId;
  bookmark: UserLastPosition;
  rootVideoId: string;
  rootVideoType: VideoType;
  episodeId: string | null;
}): Promise<BookmarkResumePlacement> {
  const { userId, bookmark, rootVideoId, rootVideoType, episodeId } = params;

  const totalParts = await dashTime("countParts(forResume)", () =>
    rootVideoType === "series" && episodeId
      ? countPartsForEpisode(episodeId)
      : rootVideoType !== "series"
        ? countPartsForVideo(rootVideoId)
        : Promise.resolve(0),
  );

  if (totalParts < 1) {
    return placementFrom(bookmark.sectionIndex, bookmark.visibleUnitStep);
  }

  const scopeIds =
    rootVideoType === "series" && episodeId
      ? { episodeId, videoId: rootVideoId, totalParts }
      : { videoId: rootVideoId, totalParts };

  const highestUnlocked = await dashTime(
    "findHighestUnlockedSectionIndex",
    () =>
      findHighestUnlockedSectionIndex({
        userId,
        ...scopeIds,
      }),
  );

  if (bookmark.sectionIndex < highestUnlocked) {
    return placementFrom(highestUnlocked, 1);
  }

  if (bookmark.sectionIndex > highestUnlocked) {
    return placementFrom(highestUnlocked, 1);
  }

  return placementFrom(
    highestUnlocked,
    resolveSectionStartStep(
      highestUnlocked,
      VISIBLE_UNITS_PER_SECTION,
      bookmark,
    ),
  );
}
