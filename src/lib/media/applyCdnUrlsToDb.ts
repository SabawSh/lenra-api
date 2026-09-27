import { withMysqlConnectionRetry } from "@/lib/db/withMysqlConnectionRetry";
import {
  ensureCanonicalShellForVideo,
  fetchAllVideoTags,
  findEpisodeIdBySeasonAndEpisodeNum,
  findFirstPartByVideoAnyEpisodeNull,
  findSeasonIdByVideoAndSeasonNum,
  insertPartRecord,
  updateEpisodeCoverUrl,
  updatePartsHlsManifestByEpisodeAndOrder,
  updatePartsHlsManifestByVideoStandaloneOrder,
  updatePartHlsManifestById,
  updatePartsUrlByEpisodeAndOrder,
  updatePartsUrlByVideoStandaloneOrder,
  updatePartUrlById,
  updateSeasonCoverUrl,
  updateVideoCoverUrl,
} from "@/lib/db/queries/videos";
import { slugContentTitle } from "@/lib/storage/mediaUploadKey";
import type { VideoType } from "@/types/video";

type VideoRow = { id: string; name: string; tag: string; type: VideoType };

/** Cleared lazily; callers can invoke after bulk DB changes outside this module (tests). */
let videoTagMap: Map<string, VideoRow> | null = null;
let videoTagMapBuiltAt = 0;
const VIDEO_TAG_MAP_TTL_MS = 60000; // re-fetch after 1 minute
const seasonIdByVideoSeason = new Map<string, string | null>();
const episodeIdBySeasonEpisode = new Map<string, string | null>();

async function ensureVideoTagMap(): Promise<Map<string, VideoRow>> {
  const now = Date.now();
  if (videoTagMap && now - videoTagMapBuiltAt < VIDEO_TAG_MAP_TTL_MS) {
    return videoTagMap;
  }
  const videos = await withMysqlConnectionRetry(() => fetchAllVideoTags());
  const m = new Map<string, VideoRow>();
  for (const v of videos) {
    m.set(v.tag.toLowerCase(), v);
  }
  videoTagMap = m;
  videoTagMapBuiltAt = now;
  return m;
}

async function findVideoByTag(tagInput: string): Promise<VideoRow | null> {
  const want = slugContentTitle(tagInput.trim() || "media");
  const m = await ensureVideoTagMap();
  return m.get(want) ?? null;
}

export function resetMediaUrlApplyCaches(): void {
  videoTagMap = null;
  videoTagMapBuiltAt = 0;
  seasonIdByVideoSeason.clear();
  episodeIdBySeasonEpisode.clear();
}

export type ApplyClipUrlInput = {
  publicUrl: string;
  contentTitle: string;
  seasonNum: number;
  episodeNum: number;
  /** Matches `Part.order` (same as upload “part” field). */
  partOrder: number;
};

export type ApplyCoverUrlInput = {
  publicUrl: string;
  contentTitle: string;
  seasonNum: number;
  episodeNum: number;
};

export async function applyClipPublicUrl(
  input: ApplyClipUrlInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tag = slugContentTitle(input.contentTitle.trim() || "media");
  const video = await findVideoByTag(tag);
  if (!video) {
    return { ok: false, reason: `No video matched tag "${tag}"` };
  }

  if (video.type === "series") {
    if (input.episodeNum <= 0) {
      return {
        ok: false,
        reason: "Series clips require episode number greater than zero",
      };
    }
    const seasonKey = `${video.id}:${input.seasonNum}`;
    let seasonId = seasonIdByVideoSeason.get(seasonKey);
    if (seasonId === undefined) {
      const id = await withMysqlConnectionRetry(() =>
        findSeasonIdByVideoAndSeasonNum(video.id, input.seasonNum),
      );
      seasonId = id ?? null;
      seasonIdByVideoSeason.set(seasonKey, seasonId);
    }
    if (!seasonId) {
      return {
        ok: false,
        reason: `Season S${input.seasonNum} not found for "${video.name}"`,
      };
    }
    const episodeKey = `${seasonId}:${input.episodeNum}`;
    let episodeId = episodeIdBySeasonEpisode.get(episodeKey);
    if (episodeId === undefined) {
      const id = await withMysqlConnectionRetry(() =>
        findEpisodeIdBySeasonAndEpisodeNum(seasonId, input.episodeNum),
      );
      episodeId = id ?? null;
      episodeIdBySeasonEpisode.set(episodeKey, episodeId);
    }
    if (!episodeId) {
      return {
        ok: false,
        reason: `Episode E${input.episodeNum} not found in season ${input.seasonNum}`,
      };
    }

    const count = await withMysqlConnectionRetry(() =>
      updatePartsUrlByEpisodeAndOrder(episodeId, input.partOrder, input.publicUrl),
    );
    if (count === 0) {
      return {
        ok: false,
        reason: `No part with order ${input.partOrder} on that episode`,
      };
    }
    return { ok: true };
  }

  /* movie | documentary — parts keyed by videoId + order */
  let updated = await withMysqlConnectionRetry(() =>
    updatePartsUrlByVideoStandaloneOrder(
      video.id,
      input.partOrder,
      input.publicUrl,
    ),
  );
  if (updated === 0) {
    const loose = await withMysqlConnectionRetry(() =>
      findFirstPartByVideoAnyEpisodeNull(video.id, input.partOrder),
    );
    if (loose) {
      const ok = await withMysqlConnectionRetry(() =>
        updatePartUrlById(loose.id, input.publicUrl),
      );
      if (ok) updated = 1;
    }
  }
  if (updated === 0) {
    return {
      ok: false,
      reason: `No part with order ${input.partOrder} on "${video.name}"`,
    };
  }
  return { ok: true };
}

export type ApplyClipHlsManifestInput = ApplyClipUrlInput;

export async function applyClipHlsManifestUrl(
  input: ApplyClipHlsManifestInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tag = slugContentTitle(input.contentTitle.trim() || "media");
  const video = await findVideoByTag(tag);
  if (!video) {
    return { ok: false, reason: `No video matched tag "${tag}"` };
  }

  if (video.type === "series") {
    if (input.episodeNum <= 0) {
      return {
        ok: false,
        reason: "Series clips require episode number greater than zero",
      };
    }
    const seasonKey = `${video.id}:${input.seasonNum}`;
    let seasonId = seasonIdByVideoSeason.get(seasonKey);
    if (seasonId === undefined) {
      const id = await withMysqlConnectionRetry(() =>
        findSeasonIdByVideoAndSeasonNum(video.id, input.seasonNum),
      );
      seasonId = id ?? null;
      seasonIdByVideoSeason.set(seasonKey, seasonId);
    }
    if (!seasonId) {
      return {
        ok: false,
        reason: `Season S${input.seasonNum} not found for "${video.name}"`,
      };
    }
    const episodeKey = `${seasonId}:${input.episodeNum}`;
    let episodeId = episodeIdBySeasonEpisode.get(episodeKey);
    if (episodeId === undefined) {
      const id = await withMysqlConnectionRetry(() =>
        findEpisodeIdBySeasonAndEpisodeNum(seasonId, input.episodeNum),
      );
      episodeId = id ?? null;
      episodeIdBySeasonEpisode.set(episodeKey, episodeId);
    }
    if (!episodeId) {
      return {
        ok: false,
        reason: `Episode E${input.episodeNum} not found in season ${input.seasonNum}`,
      };
    }

    const count = await withMysqlConnectionRetry(() =>
      updatePartsHlsManifestByEpisodeAndOrder(
        episodeId,
        input.partOrder,
        input.publicUrl,
      ),
    );
    if (count === 0) {
      return {
        ok: false,
        reason: `No part with order ${input.partOrder} on that episode`,
      };
    }
    return { ok: true };
  }

  let updated = await withMysqlConnectionRetry(() =>
    updatePartsHlsManifestByVideoStandaloneOrder(
      video.id,
      input.partOrder,
      input.publicUrl,
    ),
  );
  if (updated === 0) {
    const loose = await withMysqlConnectionRetry(() =>
      findFirstPartByVideoAnyEpisodeNull(video.id, input.partOrder),
    );
    if (loose) {
      const ok = await withMysqlConnectionRetry(() =>
        updatePartHlsManifestById(loose.id, input.publicUrl),
      );
      if (ok) updated = 1;
    }
  }
  if (updated === 0) {
    try {
      const { episodeId } = await ensureCanonicalShellForVideo(video.id);
      await insertPartRecord({
        episodeId,
        order: input.partOrder,
        text: `Part ${input.partOrder}`,
        videoUrl: input.publicUrl,
        playbackDurationMs: 1,
        playbackStartMs: 0,
        playbackEndMs: 1,
        hlsManifestUrl: input.publicUrl,
      });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: `No part with order ${input.partOrder} on "${video.name}" (${msg})`,
      };
    }
  }
  return { ok: true };
}

export async function applyCoverPublicUrl(
  input: ApplyCoverUrlInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tag = slugContentTitle(input.contentTitle.trim() || "media");
  const video = await findVideoByTag(tag);
  if (!video) {
    return { ok: false, reason: `No video matched tag "${tag}"` };
  }

  if (video.type === "series") {
    if (input.episodeNum > 0) {
      if (input.seasonNum <= 0) {
        return {
          ok: false,
          reason: "Season number required for episode covers",
        };
      }
      const seasonKey = `${video.id}:${input.seasonNum}`;
      let seasonId = seasonIdByVideoSeason.get(seasonKey);
      if (seasonId === undefined) {
        const id = await withMysqlConnectionRetry(() =>
          findSeasonIdByVideoAndSeasonNum(video.id, input.seasonNum),
        );
        seasonId = id ?? null;
        seasonIdByVideoSeason.set(seasonKey, seasonId);
      }
      if (!seasonId) {
        return {
          ok: false,
          reason: `Season S${input.seasonNum} not found for "${video.name}"`,
        };
      }
      const episodeKey = `${seasonId}:${input.episodeNum}`;
      let episodeId = episodeIdBySeasonEpisode.get(episodeKey);
      if (episodeId === undefined) {
        const id = await withMysqlConnectionRetry(() =>
          findEpisodeIdBySeasonAndEpisodeNum(seasonId, input.episodeNum),
        );
        episodeId = id ?? null;
        episodeIdBySeasonEpisode.set(episodeKey, episodeId);
      }
      if (!episodeId) {
        return {
          ok: false,
          reason: `Episode E${input.episodeNum} not found`,
        };
      }
      const ok = await withMysqlConnectionRetry(() =>
        updateEpisodeCoverUrl(episodeId, input.publicUrl),
      );
      if (!ok) {
        return { ok: false, reason: "Episode update had no matching row" };
      }
      return { ok: true };
    }
    if (input.seasonNum > 0) {
      const seasonKey = `${video.id}:${input.seasonNum}`;
      let seasonId = seasonIdByVideoSeason.get(seasonKey);
      if (seasonId === undefined) {
        const id = await withMysqlConnectionRetry(() =>
          findSeasonIdByVideoAndSeasonNum(video.id, input.seasonNum),
        );
        seasonId = id ?? null;
        seasonIdByVideoSeason.set(seasonKey, seasonId);
      }
      if (!seasonId) {
        return {
          ok: false,
          reason: `Season S${input.seasonNum} not found for "${video.name}"`,
        };
      }
      const ok = await withMysqlConnectionRetry(() =>
        updateSeasonCoverUrl(seasonId, input.publicUrl),
      );
      if (!ok) {
        return { ok: false, reason: "Season update had no matching row" };
      }
      return { ok: true };
    }
    const ok = await withMysqlConnectionRetry(() =>
      updateVideoCoverUrl(video.id, input.publicUrl),
    );
    if (!ok) {
      return { ok: false, reason: "Video update had no matching row" };
    }
    return { ok: true };
  }

  /* movie banner */
  const ok = await withMysqlConnectionRetry(() =>
    updateVideoCoverUrl(video.id, input.publicUrl),
  );
  if (!ok) {
    return { ok: false, reason: "Video update had no matching row" };
  }
  return { ok: true };
}
