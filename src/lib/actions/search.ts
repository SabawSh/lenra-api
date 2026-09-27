"use server";

import * as vq from "@/lib/db/queries/videos";

export type SearchResult = {
  id: string;
  name: string;
  type: "movie" | "series" | "documentary";
  coverUrl: string | null;
};

export async function searchVideos(
  q: string,
  limit = 6,
): Promise<SearchResult[]> {
  if (q.trim().length < 2) return [];

  const data = await vq.searchVideosByNamePrefix(q.trim(), limit);

  return data.map((v) => ({
    id: v.id,
    name: v.name,
    type: v.type as SearchResult["type"],
    coverUrl: v.coverUrl ?? null,
  }));
}
