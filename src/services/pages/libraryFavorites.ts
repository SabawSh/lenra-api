import { getLikedVideos } from "@/lib/db/likedVideos";
import { attachMovieLibraryProgress } from "@/lib/db/movieLibraryProgress";
import { attachSeriesLibraryProgress } from "@/lib/db/seriesLibraryProgress";
import type { Video } from "@/types/video";
import type { UserId } from "@/types/schema";

async function enrichLikedVideos(userId: UserId, liked: Video[]): Promise<Video[]> {
  const series = liked.filter((v) => v.type === "series");
  const movies = liked.filter((v) => v.type === "movie");
  const [enrichedSeries, enrichedMovies] = await Promise.all([
    attachSeriesLibraryProgress(userId, series),
    attachMovieLibraryProgress(userId, movies),
  ]);
  const byId = new Map(
    [...enrichedSeries, ...enrichedMovies].map((v) => [v.id, v]),
  );
  return liked.map((v) => byId.get(v.id) ?? v);
}

export async function buildFavoritesPage(userId: UserId | null) {
  const liked = await getLikedVideos();
  const videos = userId ? await enrichLikedVideos(userId, liked) : liked;
  return { videos };
}
