import type { UserId } from "@/types/schema";
import type { UserVideoLastSeenRecord } from "@/lib/db/queries/userVideoLastSeen";
import { getUserLastPositionFromProgress } from "@/lib/db/partResume";
import {
  ensureCanonicalShellForVideo,
  fetchVideoScalarsById,
  isStandaloneVideoType,
} from "@/lib/db/queries/videos";
import {
  findUserVideoLastSeenForVideo,
  findUserVideoLastSeenForEpisode,
  findUserVideoLastSeenForSeason,
  listUserVideoLastSeenForUser,
  upsertUserVideoLastSeen,
} from "@/lib/db/queries/userVideoLastSeen";
import {
  bookmarkOrderForVisibleStep,
  type UserLastPosition,
  visibleStepFromBookmarkOrder,
} from "@/lib/learning/sectionResume";

export type { UserVideoLastSeenRecord };

type SaveLastSeenParams = {
  userId: UserId;
  videoId: string;
  order: number;
  seasonId?: string;
  episodeId?: string;
};

/** Optional bookmark only — does not drive canonical progression. */
export const saveUserVideoLastSeen = async ({
  userId,
  videoId,
  order,
  seasonId,
  episodeId,
}: SaveLastSeenParams) => {
  try {
    let resolvedSeasonId = seasonId ?? null;
    let resolvedEpisodeId = episodeId ?? null;
    if (resolvedSeasonId == null && resolvedEpisodeId == null) {
      const video = await fetchVideoScalarsById(videoId);
      if (video && isStandaloneVideoType(video.type)) {
        const shell = await ensureCanonicalShellForVideo(videoId);
        resolvedSeasonId = shell.seasonId;
        resolvedEpisodeId = shell.episodeId;
      }
    }
    await upsertUserVideoLastSeen({
      userId,
      videoId,
      order,
      seasonId: resolvedSeasonId,
      episodeId: resolvedEpisodeId,
    });
  } catch {
    // Database unavailable in local/dev contexts.
  }
};

export const getUserVideoLastSeen = async (
  userId: UserId,
): Promise<UserVideoLastSeenRecord[]> => {
  try {
    return await listUserVideoLastSeenForUser(userId);
  } catch {
    return [];
  }
};

export const getUserLastSeenForSeason = async (
  userId: UserId,
  videoId: string,
  seasonId: string,
): Promise<UserVideoLastSeenRecord | null> => {
  try {
    return await findUserVideoLastSeenForSeason(userId, videoId, seasonId);
  } catch {
    return null;
  }
};

export const getUserLastPositionForStandalone = async (
  userId: UserId,
  videoId: string,
): Promise<UserLastPosition | null> => {
  try {
    const bookmark = await findUserVideoLastSeenForVideo(userId, videoId);
    if (bookmark) {
      const decoded = visibleStepFromBookmarkOrder(bookmark.order);
      return {
        sectionIndex: decoded.sectionIndex,
        visibleUnitStep: decoded.visibleUnitStep,
      };
    }
    return await getUserLastPositionFromProgress(userId, { videoId });
  } catch {
    return null;
  }
};

export const getUserLastPositionForEpisode = async (
  userId: UserId,
  videoId: string,
  episodeId: string,
): Promise<UserLastPosition | null> => {
  try {
    const { dashTime } = await import("@/lib/debug/dashboardTiming");
    const bookmark = await dashTime(
      "SQL findUserVideoLastSeenForEpisode",
      () => findUserVideoLastSeenForEpisode(userId, videoId, episodeId),
    );
    if (bookmark) {
      const decoded = visibleStepFromBookmarkOrder(bookmark.order);
      return {
        sectionIndex: decoded.sectionIndex,
        visibleUnitStep: decoded.visibleUnitStep,
      };
    }
    return await dashTime("getUserLastPositionFromProgress", () =>
      getUserLastPositionFromProgress(userId, { episodeId }),
    );
  } catch {
    return null;
  }
};

export const saveUserEpisodeLastPosition = async ({
  userId,
  videoId,
  seasonId,
  episodeId,
  sectionIndex,
  partInSection,
}: {
  userId: UserId;
  videoId: string;
  seasonId: string;
  episodeId: string;
  sectionIndex: number;
  /** 1-based visible learning unit step within the section. */
  partInSection: number;
}) => {
  const order = bookmarkOrderForVisibleStep(sectionIndex, partInSection);
  await saveUserVideoLastSeen({
    userId,
    videoId,
    order,
    seasonId,
    episodeId,
  });
};
