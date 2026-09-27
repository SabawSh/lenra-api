import { getVideoLibrary } from "@/lib/db/videoLibrary";
import { attachVideoLibraryProgress } from "@/lib/db/videoLibraryProgress";
import type { UserId } from "@/types/schema";

export async function buildLibraryVideosPage(userId: UserId | null) {
  const videos = await getVideoLibrary().catch(() => []);
  const enriched = userId
    ? await attachVideoLibraryProgress(userId, videos).catch(() => videos)
    : videos;
  return { videos: enriched };
}
