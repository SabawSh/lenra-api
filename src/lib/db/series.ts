import { revalidateTag, unstable_cache } from "next/cache";

import * as vq from "@/lib/db/queries/videos";
import { mapVideoGenres } from "@/lib/db/jsonStringArray";
import type { Episode, Season, Video } from "@/types/video";

export const getSeries = unstable_cache(
  async (): Promise<Video[]> => {
    return vq.fetchSeriesListVideos();
  },
  ["series-list"],
  { revalidate: 300, tags: ["videos", "seasons", "episodes"] },
);

export const getVideoWithSeasons = unstable_cache(
  async (videoId: string) => {
    return vq.loadVideoWithSeasonsAscending(videoId);
  },
  ["video-with-seasons"],
  { revalidate: 864000, tags: ["videos", "seasons"] },
);

export const getSeasonWithEpisodes = unstable_cache(
  async (videoId: string, seasonId: string) => {
    return vq.loadVideoScopedSeasonWithEpisodes(videoId, seasonId);
  },
  ["season-with-episodes"],
  { revalidate: 864000, tags: ["seasons", "episodes"] },
);

export const getVideoSeasonShellForLearn = unstable_cache(
  async (videoId: string, seasonId: string) => {
    return vq.fetchVideoSeasonShellLearn(videoId, seasonId);
  },
  ["video-season-shell"],
  { revalidate: 864000, tags: ["videos", "seasons"] },
);

export const getEpisodeSummaryFields = unstable_cache(
  async (episodeId: string) => {
    return vq.fetchEpisodeSummaryWithPartUrls(episodeId);
  },
  ["episode-summary"],
  { revalidate: 864000, tags: ["episodes"] },
);

export const getSeasonsWithEpisodes = unstable_cache(
  async (videoId: string) => {
    return vq.loadSeasonsWithEpisodesForVideo(videoId);
  },
  ["seasons-with-episodes"],
  { revalidate: 864000, tags: ["seasons", "episodes"] },
);

export const createSeason = async (
  videoId: string,
  seasonNum: number,
  coverUrl?: string,
) => {
  const result = await vq.insertSeasonRecord({
    videoId,
    seasonNum,
    coverUrl,
  });
  revalidateTag("seasons", { expire: 0 });
  return result;
};

export const createEpisode = async (
  seasonId: string,
  episodeNum: number,
  title: string,
  description?: string,
  releaseAt?: Date,
  coverUrl?: string,
) => {
  const result = await vq.insertEpisodeRecord({
    seasonId,
    episodeNum,
    title,
    description,
    releaseAt: releaseAt ?? new Date(),
    coverUrl,
  });
  revalidateTag("episodes", { expire: 0 });
  return result;
};

export const getSeasonsByVideoId = unstable_cache(
  async (videoId: string) => {
    return vq.loadSeasonsNestedEpisodesParts(videoId);
  },
  ["seasons-by-video"],
  { revalidate: 864000, tags: ["seasons", "episodes"] },
);

export const getEpisodeById = unstable_cache(
  async (episodeId: string): Promise<Episode | null> => {
    return vq.fetchEpisodeById(episodeId);
  },
  ["episode-by-id"],
  { revalidate: 864000, tags: ["episodes"] },
);

export const getEpisodesBySeasonId = unstable_cache(
  async (seasonId: string) => {
    return vq.listEpisodesWithPartsBySeasonId(seasonId);
  },
  ["episodes-by-season"],
  { revalidate: 864000, tags: ["episodes"] },
);

export const getSeasonWithEpisodesAndParts = unstable_cache(
  async (seasonId: string) => {
    return vq.loadSeasonWithEpisodesAndPartsGraph(seasonId);
  },
  ["season-with-parts"],
  { revalidate: 864000, tags: ["seasons", "episodes"] },
);

// Re-export for modules that relied on json mapping helper with Video rows
export { mapVideoGenres };
