import type { UserId } from "@/types/schema";
import {
  listUserPartProgressForStandaloneMovieVideos,
} from "@/lib/db/queries/progress";
import { listStandaloneMoviePartPairsForVideos } from "@/lib/db/queries/videos";
import type { Video } from "@/types/video";

/**
 * Adds `progressPct` and `watched` to standalone titles (movie / documentary)
 * via the canonical S1E1 episode shell.
 */
export async function attachMovieLibraryProgress(
  userId: UserId,
  movies: Video[],
): Promise<Video[]> {
  if (movies.length === 0) return movies;

  const videoIds = movies.map((m) => m.id);

  const [parts, progressRows] = await Promise.all([
    listStandaloneMoviePartPairsForVideos(videoIds),
    listUserPartProgressForStandaloneMovieVideos(userId, videoIds),
  ]);

  const completedIds = new Set(
    progressRows
      .filter((r) => r.completedAt != null)
      .map((r) => r.partId),
  );
  const startedIds = new Set(progressRows.map((r) => r.partId));

  const partsByVideo = new Map<string, string[]>();
  for (const p of parts) {
    const list = partsByVideo.get(p.videoId) ?? [];
    list.push(p.id);
    partsByVideo.set(p.videoId, list);
  }

  return movies.map((item) => {
    const scopePartIds = partsByVideo.get(item.id) ?? [];

    if (scopePartIds.length === 0) {
      return { ...item, progressPct: 0, watched: false };
    }

    const completedCount = scopePartIds.filter((id) =>
      completedIds.has(id),
    ).length;
    const progressPct = Math.min(
      100,
      Math.round((completedCount / scopePartIds.length) * 100),
    );
    const watched =
      scopePartIds.some((id) => startedIds.has(id)) || progressPct > 0;

    return {
      ...item,
      progressPct,
      watched,
      partsCount: scopePartIds.length || item.partsCount,
    };
  });
}
