import type { UserId } from "@/types/schema";
import {
  listUserPartProgressForSeriesVideos,
} from "@/lib/db/queries/progress";
import { listLatestProgressEpisodeByVideo } from "@/lib/db/queries/partProgression";
import { listSeriesLibraryPartRows } from "@/lib/db/queries/videos";
import type { Video } from "@/types/video";

type SeriesPartRow = {
  id: string;
  order: number;
  episodeId: string | null;
  seriesVideoId: string;
};

/**
 * Adds `progressPct` and `watched` to series list items using completed parts,
 * scoped to the episode with the most recent part progress when available.
 */
export async function attachSeriesLibraryProgress(
  userId: UserId,
  series: Video[],
): Promise<Video[]> {
  if (series.length === 0) return series;

  const videoIds = series.map((s) => s.id);

  const [rawParts, progressEpisodeRows, progressRows] = await Promise.all([
    listSeriesLibraryPartRows(videoIds),
    listLatestProgressEpisodeByVideo(userId, videoIds),
    listUserPartProgressForSeriesVideos(userId, videoIds),
  ]);

  const parts: SeriesPartRow[] = rawParts.map((p) => ({
    id: p.id,
    order: p.order,
    episodeId: p.episodeId,
    seriesVideoId: p.seriesVideoId,
  }));

  const completedIds = new Set(
    progressRows
      .filter((r) => r.completedAt != null)
      .map((r) => r.partId),
  );
  const startedIds = new Set(progressRows.map((r) => r.partId));
  const progressEpisodeByVideo = new Map(
    progressEpisodeRows.map((r) => [r.videoId, r.episodeId]),
  );

  const partsByVideo = new Map<string, SeriesPartRow[]>();
  for (const p of parts) {
    const list = partsByVideo.get(p.seriesVideoId) ?? [];
    list.push(p);
    partsByVideo.set(p.seriesVideoId, list);
  }

  return series.map((item) => {
    const allParts = partsByVideo.get(item.id) ?? [];
    const lastEpisodeId = progressEpisodeByVideo.get(item.id);

    let scopeParts = allParts;
    if (lastEpisodeId) {
      const episodeParts = allParts.filter((p) => p.episodeId === lastEpisodeId);
      if (episodeParts.length > 0) scopeParts = episodeParts;
    }

    if (scopeParts.length === 0) {
      return { ...item, progressPct: 0, watched: false };
    }

    const completedCount = scopeParts.filter((p) =>
      completedIds.has(p.id),
    ).length;
    const progressPct = Math.min(
      100,
      Math.round((completedCount / scopeParts.length) * 100),
    );
    const watched =
      scopeParts.some((p) => startedIds.has(p.id)) || progressPct > 0;

    return { ...item, progressPct, watched };
  });
}
