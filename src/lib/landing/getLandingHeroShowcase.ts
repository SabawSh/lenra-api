import { unstable_cache } from "next/cache";

import { getVideoLibrary } from "@/lib/db/videoLibrary";
import { countPartsForVideoId } from "@/lib/db/queries/videos";
import { isLandingHeroShowcaseEligible } from "@/lib/landing/heroShowcase";
import type { VideoType } from "@/types/schema";

export type LandingHeroShowcaseItem = {
  id: string;
  name: string;
  coverUrl: string | null;
  type: VideoType;
  genres: string[];
  releaseYear: number;
  partsCount: number;
  seasonCount: number;
  imdbRating: number | null;
  levels: string[];
};

const SHOWCASE_LIMIT = 6;

async function loadLandingHeroShowcase(): Promise<LandingHeroShowcaseItem[]> {
  const library = await getVideoLibrary();
  const items: LandingHeroShowcaseItem[] = [];

  for (const video of library) {
    if (items.length >= SHOWCASE_LIMIT) break;

    let partsCount = video.partsCount ?? 0;
    if (partsCount === 0) {
      partsCount = await countPartsForVideoId(video.id);
    }

    if (!isLandingHeroShowcaseEligible(video, partsCount)) continue;

    items.push({
      id: video.id,
      name: video.name,
      coverUrl: video.coverUrl,
      type: video.type,
      genres: video.genres,
      releaseYear: new Date(video.releaseAt).getFullYear(),
      partsCount,
      seasonCount: video.seasons?.length ?? 0,
      imdbRating: video.imdbRating,
      levels: video.levels,
    });
  }

  return items;
}

export const getLandingHeroShowcase = unstable_cache(
  loadLandingHeroShowcase,
  ["landing-hero-showcase"],
  { revalidate: 300, tags: ["videos", "seasons", "episodes"] },
);
