import { attachMovieLibraryProgress } from "@/lib/db/movieLibraryProgress";
import { attachSeriesLibraryProgress } from "@/lib/db/seriesLibraryProgress";
import type { UserId } from "@/types/schema";
import type { Video } from "@/types/video";

/** Attaches library progress for series and standalone titles (movies, documentaries). */
export async function attachVideoLibraryProgress(
  userId: UserId,
  videos: Video[],
): Promise<Video[]> {
  if (videos.length === 0) return videos;

  const series = videos.filter((v) => v.type === "series");
  const standalone = videos.filter((v) => v.type !== "series");

  const [seriesOut, standaloneOut] = await Promise.all([
    attachSeriesLibraryProgress(userId, series),
    attachMovieLibraryProgress(userId, standalone),
  ]);

  const byId = new Map(
    [...seriesOut, ...standaloneOut].map((v) => [v.id, v] as const),
  );
  return videos.map((v) => byId.get(v.id) ?? v);
}
