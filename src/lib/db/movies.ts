import { unstable_cache } from "next/cache";

import * as vq from "@/lib/db/queries/videos";
import { Video } from "@/types/video";

export const getMovies = unstable_cache(
  async (): Promise<Video[]> => {
    const rows = await vq.listVideosByTypes(["movie"]);
    const partCounts = await vq.countPartsForVideoIds(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...row,
      genres: row.genres,
      partsCount: partCounts.get(row.id) ?? 0,
    }));
  },
  ["movies-list"],
  { revalidate: 300, tags: ["videos"] },
);

export const searchVideos = async (q: string, limit = 6): Promise<Video[]> => {
  if (q.trim().length < 2) return [];

  const data = await vq.searchVideosByNamePrefix(q.trim(), limit);
  return data.map((row) => ({
    ...row,
    genres: row.genres,
  }));
};
