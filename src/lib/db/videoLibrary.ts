import { unstable_cache } from "next/cache";

import * as vq from "@/lib/db/queries/videos";
import { getSeries } from "@/lib/db/series";
import type { Video } from "@/types/video";

export const getVideoLibrary = unstable_cache(
  async (): Promise<Video[]> => {
    const [series, standalone] = await Promise.all([
      getSeries(),
      vq.listVideosByTypes(["movie", "documentary"]),
    ]);

    const standaloneIds = standalone.map((row) => row.id);
    const seriesIds = series.map((row) => row.id);
    const allIds = [...seriesIds, ...standaloneIds];

    const [partCounts, difficultyMixes] = await Promise.all([
      vq.countPartsForVideoIds(standaloneIds),
      vq.countPartDifficultyForVideoIds(allIds),
    ]);

    const movies: Video[] = standalone.map((row) => ({
      ...row,
      genres: row.genres,
      partsCount: partCounts.get(row.id) ?? 0,
      difficultyMix: difficultyMixes.get(row.id),
    }));

    const seriesWithMix: Video[] = series.map((row) => ({
      ...row,
      difficultyMix: difficultyMixes.get(row.id),
    }));

    return [...seriesWithMix, ...movies].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  },
  ["video-library-list"],
  { revalidate: 300, tags: ["videos", "seasons", "episodes"] },
);
