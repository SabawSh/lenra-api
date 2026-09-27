import * as vq from "@/lib/db/queries/videos";
import type { Video } from "@/types/video";

/** All videos the user marked with a heart (`Video.isLiked`). */
export async function getLikedVideos(): Promise<Video[]> {
  const rows = await vq.listLikedVideosWithCounts();

  return rows.map(({ video, seasons, partsCount }) => ({
    ...video,
    genres: video.genres,
    seasons,
    partsCount,
  }));
}

export async function setVideoIsLiked(
  videoId: string,
  isLiked: boolean,
): Promise<boolean> {
  const ok = await vq.updateVideoIsLiked(videoId, isLiked);
  if (!ok) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  return isLiked;
}
