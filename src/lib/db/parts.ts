import { revalidateTag, unstable_cache } from "next/cache";

import * as videoQueries from "@/lib/db/queries/videos";
import type { CaptionTranslation, Part } from "@/types/video";

/** Omit undefined scope so SQL `where` clauses stay precise. */
function partOwnershipWhere(videoId?: string, episodeId?: string) {
  return {
    ...(videoId ? { videoId } : {}),
    ...(episodeId ? { episodeId } : {}),
  };
}

export const getMovieWithParts = unstable_cache(
  async (videoId: string) => videoQueries.loadMovieWithParts(videoId),
  ["movie-with-parts"],
  { revalidate: 864000, tags: ["videos"] },
);

export const getStandaloneVideoWithParts = unstable_cache(
  async (videoId: string) =>
    videoQueries.loadStandaloneVideoWithParts(videoId),
  ["standalone-video-with-parts"],
  { revalidate: 864000, tags: ["videos"] },
);

export const getStandaloneVideoMeta = unstable_cache(
  async (
    videoId: string,
  ): Promise<{ id: string; type: string; name: string } | null> => {
    return videoQueries.fetchStandaloneVideoLeanMeta(videoId);
  },
  ["standalone-video-meta"],
  { revalidate: 864000, tags: ["videos"] },
);

export const getEpisodeWithParts = unstable_cache(
  async (episodeId: string) => {
    return videoQueries.loadEpisodeWithPartsSeasonVideo(episodeId);
  },
  ["episode-with-parts"],
  { revalidate: 864000, tags: ["episodes"] },
);

export const getPartByOrder = unstable_cache(
  async ({
    order,
    videoId,
    episodeId,
  }: {
    order: number;
    videoId?: string;
    episodeId?: string;
  }): Promise<(Part & { translations: CaptionTranslation[] }) | null> => {
    return videoQueries.findPartByOrderWithTranslations({
      order,
      ...partOwnershipWhere(videoId, episodeId),
    });
  },
  ["part-by-order"],
  { revalidate: 864000, tags: ["episodes", "videos"] },
);

export const getPartClipUrlByOrder = unstable_cache(
  async ({
    order,
    videoId,
    episodeId,
  }: {
    order: number;
    videoId?: string;
    episodeId?: string;
  }): Promise<string | null> => {
    return videoQueries.findPartClipUrlByOrderScoped({
      order,
      ...partOwnershipWhere(videoId, episodeId),
    });
  },
  ["part-clip-url-by-order"],
  { revalidate: 864000, tags: ["episodes", "videos"] },
);

const getPartClipUrlRowsForOrders = unstable_cache(
  async ({
    orders,
    videoId,
    episodeId,
  }: {
    orders: number[];
    videoId?: string;
    episodeId?: string;
  }): Promise<Array<{ order: number; url: string }>> => {
    return videoQueries.listPartUrlsForOrders({
      orders,
      ...partOwnershipWhere(videoId, episodeId),
    });
  },
  ["part-clip-urls-for-orders"],
  { revalidate: 864000, tags: ["episodes", "videos"] },
);

export const getPartClipUrlsForOrders = async ({
  orders,
  videoId,
  episodeId,
}: {
  orders: number[];
  videoId?: string;
  episodeId?: string;
}): Promise<Map<number, string>> => {
  const rows = await getPartClipUrlRowsForOrders({
    orders,
    videoId,
    episodeId,
  });
  const m = new Map<number, string>();
  for (const r of rows) m.set(r.order, r.url);
  return m;
};

export type PartPreloadMeta = {
  url: string;
  hlsManifestUrl: string | null;
};

const getPartPreloadMetaRowsForOrders = unstable_cache(
  async ({
    orders,
    videoId,
    episodeId,
  }: {
    orders: number[];
    videoId?: string;
    episodeId?: string;
  }): Promise<
    Array<{ order: number; url: string; hlsManifestUrl: string | null }>
  > => {
    return videoQueries.listPartPreloadMetaForOrdersScoped({
      orders,
      ...partOwnershipWhere(videoId, episodeId),
    });
  },
  ["part-preload-meta-for-orders"],
  { revalidate: 864000, tags: ["episodes", "videos"] },
);

export const getPartPreloadMetaForOrders = async ({
  orders,
  videoId,
  episodeId,
}: {
  orders: number[];
  videoId?: string;
  episodeId?: string;
}): Promise<Map<number, PartPreloadMeta>> => {
  const rows = await getPartPreloadMetaRowsForOrders({
    orders,
    videoId,
    episodeId,
  });
  const m = new Map<number, PartPreloadMeta>();
  for (const r of rows) {
    m.set(r.order, { url: r.url, hlsManifestUrl: r.hlsManifestUrl });
  }
  return m;
};

export const createPart = async (
  text: string,
  videoUrl: string,
  difficulty: number,
  playbackDurationMs: number,
  order: number,
  episodeId: string,
  playbackStartMs = 0,
  playbackEndMs = playbackDurationMs,
) => {
  const result = await videoQueries.insertPartRecord({
    text,
    videoUrl,
    difficulty,
    playbackDurationMs,
    order,
    episodeId,
    playbackStartMs,
    playbackEndMs,
  });
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
  return result;
};

/**
 * Process-local curriculum cache keyed by scope + content stamp.
 * Do NOT use next/cache unstable_cache here: under the Hono/tsx API runtime it
 * ignores dynamic args and returns the first video/episode's rows for every call
 * (reproduced as Pursuit 1508 → Coraline 759 contamination).
 */
type OrderMetaCacheEntry = {
  stamp: string;
  rows: videoQueries.PartOrderMeta[];
};

const episodeOrderMetaCache = new Map<string, OrderMetaCacheEntry>();
const videoOrderMetaCache = new Map<string, OrderMetaCacheEntry>();

async function loadEpisodeOrderMetaFresh(
  episodeId: string,
  stamp: string,
): Promise<videoQueries.PartOrderMeta[]> {
  const hit = episodeOrderMetaCache.get(episodeId);
  if (hit && hit.stamp === stamp) return hit.rows;
  const rows = await videoQueries.listPartOrderMetaByEpisodeId(episodeId);
  episodeOrderMetaCache.set(episodeId, { stamp, rows });
  return rows;
}

async function loadVideoOrderMetaFresh(
  videoId: string,
  stamp: string,
): Promise<videoQueries.PartOrderMeta[]> {
  const hit = videoOrderMetaCache.get(videoId);
  if (hit && hit.stamp === stamp) return hit.rows;
  const rows = await videoQueries.listPartOrderMetaByVideoId(videoId);
  videoOrderMetaCache.set(videoId, { stamp, rows });
  return rows;
}

/** @deprecated Prefer {@link getVideoPartsOrderMeta} which stamps the cache key. */
export async function getPartOrderMetaByVideoId(
  videoId: string,
): Promise<videoQueries.PartOrderMeta[]> {
  return getVideoPartsOrderMeta(videoId);
}

/** Uncached — full rows exceed the 2MB Next.js Data Cache limit for long videos. */
export async function getPartsByVideoId(videoId: string): Promise<Part[]> {
  return videoQueries.listPartsByVideoOrdered(videoId);
}

/** Section-scoped parts — uncached so section bounds never collide in the Data Cache. */
export async function getPartsForSection({
  sectionStart,
  sectionEnd,
  videoId,
  episodeId,
}: {
  sectionStart: number;
  sectionEnd: number;
  videoId?: string;
  episodeId?: string;
}): Promise<Array<Part & { translations: CaptionTranslation[] }>> {
  return videoQueries.listPartsForSectionWithTranslations({
    sectionStart,
    sectionEnd,
    ...partOwnershipWhere(videoId, episodeId),
  });
}

/** @deprecated Prefer {@link getEpisodePartsOrderMeta} which stamps the cache key. */
export async function getPartOrderMetaByEpisodeId(
  episodeId: string,
): Promise<videoQueries.PartOrderMeta[]> {
  return getEpisodePartsOrderMeta(episodeId);
}

/** Uncached — full rows exceed the 2MB Next.js Data Cache limit for long episodes. */
export async function getPartsByEpisodeId(episodeId: string): Promise<Part[]> {
  return videoQueries.listPartsByEpisodeOrdered(episodeId);
}

/** Episode curriculum pool (lean) for global adaptive ordering. */
export async function getEpisodePartsOrderMeta(
  episodeId: string,
): Promise<videoQueries.PartOrderMeta[]> {
  const stamp = await videoQueries.getPartOrderCacheStampForEpisode(episodeId);
  return loadEpisodeOrderMetaFresh(episodeId, stamp);
}

/** Standalone video curriculum pool (lean) for global adaptive ordering. */
export async function getVideoPartsOrderMeta(
  videoId: string,
): Promise<videoQueries.PartOrderMeta[]> {
  const stamp = await videoQueries.getPartOrderCacheStampForVideo(videoId);
  return loadVideoOrderMetaFresh(videoId, stamp);
}

/** Hydrate a section playlist slice with full part rows + translations. */
export async function hydrateSectionPartsFromOrderMeta(
  orderedSlice: readonly { id: string }[],
): Promise<Array<Part & { translations: CaptionTranslation[] }>> {
  if (orderedSlice.length === 0) return [];
  const parts = await videoQueries.listPartsByIds(
    orderedSlice.map((p) => p.id),
  );
  return attachPartTranslations(parts);
}

export async function attachPartTranslations<T extends Part>(
  parts: T[],
): Promise<Array<T & { translations: CaptionTranslation[] }>> {
  if (parts.length === 0) return [];
  const byPartId = await videoQueries.listCaptionTranslationsByPartIds(
    parts.map((p) => p.id),
  );
  return parts.map((part) => ({
    ...part,
    translations: byPartId.get(part.id) ?? [],
  }));
}

export const deletePartById = async (id: string) => {
  const result = await videoQueries.deletePartByPk(id);
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
  return result;
};

export const updatePartText = async (id: string, text: string) => {
  const result = await videoQueries.updatePartTextById(id, text);
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
  return result;
};

export const updatePartDifficulty = async (
  id: string,
  difficulty: "easy" | "medium" | "hard",
  difficultyScore?: number | null,
) => {
  const result = await videoQueries.updatePartDifficultyById(
    id,
    difficulty,
    difficultyScore,
  );
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
  return result;
};

/** Set or clear Content Pipeline identity without changing parts.id. */
export const updatePartCanonicalKey = async (
  id: string,
  canonicalKey: string | null,
) => {
  const result = await videoQueries.updatePartCanonicalKeyById(
    id,
    canonicalKey,
  );
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
  return result;
};

/**
 * Episode-scoped lookup by Content Pipeline identity.
 * May return multiple parts when duplicate canonical content exists.
 */
export async function findPartsByCanonicalKey(params: {
  episodeId: string;
  canonicalKey: string;
}): Promise<Part[]> {
  return videoQueries.findPartsByCanonicalKey(params);
}

/** Global lookup — prefer episode-scoped helper when episodeId is known. */
export async function findPartsByCanonicalKeyGlobal(
  canonicalKey: string,
): Promise<Part[]> {
  return videoQueries.findPartsByCanonicalKeyGlobal(canonicalKey);
}
