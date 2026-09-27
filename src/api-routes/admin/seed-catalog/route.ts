import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  CANONICAL_EPISODE_NUM,
  CANONICAL_SEASON_NUM,
  ensureCanonicalShellForVideo,
  findEpisodeFirstBySeasonAndNum,
  findEpisodeIdBySeasonAndEpisodeNum,
  findSeasonIdByVideoAndSeasonNum,
  findVideoByNameAndType,
  insertEpisodeRecord,
  insertSeasonRecord,
  insertVideoScalars,
  isStandaloneVideoType,
  listSeasonsAscByVideoId,
} from "@/lib/db/queries/videos";
import { videoTagFromName } from "@/lib/storage/mediaUploadKey";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";
import type { VideoType } from "@/types/video";

const VIDEO_TYPES = new Set<VideoType>(["series", "movie", "documentary"]);
const CATALOG_VIDEO_TYPES = new Set<string>([
  ...VIDEO_TYPES,
  "animation",
]);

function isCatalogVideoType(value: unknown): value is VideoType | "animation" {
  return typeof value === "string" && CATALOG_VIDEO_TYPES.has(value);
}

function resolveCatalogVideoType(
  catalogType: VideoType | "animation",
): VideoType {
  return catalogType === "animation" ? "movie" : catalogType;
}

function parsePositiveInt(value: unknown, max = 99): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return Math.trunc(n);
}

function defaultEpisodeTitle(
  videoName: string,
  seasonNum: number,
  episodeNum: number,
): string {
  const s = String(seasonNum).padStart(2, "0");
  const e = String(episodeNum).padStart(2, "0");
  return `${videoName} S${s}E${e}`;
}

/**
 * POST /api/admin/seed-catalog
 * Idempotently ensure Video (+ Season + Episode for series) rows exist.
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  const videoName =
    typeof record?.videoName === "string" ? record.videoName.trim() : "";
  const catalogVideoType = isCatalogVideoType(record?.videoType)
    ? record.videoType
    : "series";
  const videoType = resolveCatalogVideoType(catalogVideoType);
  const seedAnimationGenre = catalogVideoType === "animation";
  const seasonNum = parsePositiveInt(record?.seasonNum);
  const episodeNum = parsePositiveInt(record?.episodeNum);
  const episodeTitleRaw =
    typeof record?.episodeTitle === "string"
      ? record.episodeTitle.trim()
      : "";
  const releaseAtRaw =
    typeof record?.releaseAt === "string" ? record.releaseAt.trim() : "";

  if (!videoName) {
    return NextResponse.json({ error: "videoName is required" }, { status: 400 });
  }

  if (videoName.length > 191) {
    return NextResponse.json(
      { error: "videoName must be at most 191 characters" },
      { status: 400 },
    );
  }

  if (videoType === "series") {
    if (seasonNum === null || episodeNum === null) {
      return NextResponse.json(
        { error: "seasonNum and episodeNum are required for series (1–99)" },
        { status: 400 },
      );
    }
  }

  let releaseAt = new Date();
  if (releaseAtRaw) {
    const parsed = new Date(releaseAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid releaseAt date" }, { status: 400 });
    }
    releaseAt = parsed;
  }

  const created: { video: boolean; season: boolean; episode: boolean } = {
    video: false,
    season: false,
    episode: false,
  };

  const tag = videoTagFromName(videoName);

  let video = await findVideoByNameAndType(videoName, videoType);
  if (!video) {
    video = await insertVideoScalars({
      name: videoName,
      tag,
      type: videoType,
      releaseAt,
      description: null,
      coverUrl: null,
      isNew: true,
      ...(seedAnimationGenre ? { genres: ["Animation"] } : {}),
    });
    created.video = true;
    revalidateTag("videos", { expire: 0 });
  }

  if (videoType !== "series" || seasonNum === null || episodeNum === null) {
    if (isStandaloneVideoType(video.type)) {
      const seasonIdBefore = await findSeasonIdByVideoAndSeasonNum(
        video.id,
        CANONICAL_SEASON_NUM,
      );
      const episodeIdBefore =
        seasonIdBefore != null
          ? await findEpisodeIdBySeasonAndEpisodeNum(
              seasonIdBefore,
              CANONICAL_EPISODE_NUM,
            )
          : null;
      const shell = await ensureCanonicalShellForVideo(video.id);
      if (!seasonIdBefore) created.season = true;
      if (!episodeIdBefore) created.episode = true;
      const seasons = await listSeasonsAscByVideoId(video.id);
      const season =
        seasons.find((s) => s.seasonNum === CANONICAL_SEASON_NUM) ?? null;
      const episode =
        season != null
          ? await findEpisodeFirstBySeasonAndNum(
              season.id,
              CANONICAL_EPISODE_NUM,
            )
          : null;
      return NextResponse.json({
        ok: true,
        created,
        video: {
          id: video.id,
          name: video.name,
          tag: video.tag,
          type: video.type,
        },
        season: season
          ? { id: season.id, seasonNum: season.seasonNum }
          : { id: shell.seasonId, seasonNum: CANONICAL_SEASON_NUM },
        episode: episode
          ? {
              id: episode.id,
              episodeNum: episode.episodeNum,
              title: episode.title,
            }
          : { id: shell.episodeId, episodeNum: CANONICAL_EPISODE_NUM },
      });
    }

    return NextResponse.json({
      ok: true,
      created,
      video: { id: video.id, name: video.name, tag: video.tag, type: video.type },
      season: null,
      episode: null,
    });
  }

  const seasons = await listSeasonsAscByVideoId(video.id);
  let season = seasons.find((s) => s.seasonNum === seasonNum);
  if (!season) {
    season = await insertSeasonRecord({
      videoId: video.id,
      seasonNum,
      coverUrl: null,
    });
    created.season = true;
    revalidateTag("seasons", { expire: 0 });
  }

  let episode = await findEpisodeFirstBySeasonAndNum(season.id, episodeNum);
  if (!episode) {
    const title =
      episodeTitleRaw ||
      defaultEpisodeTitle(videoName, seasonNum, episodeNum);
    episode = await insertEpisodeRecord({
      seasonId: season.id,
      episodeNum,
      title: title.slice(0, 191),
      description: `Episode ${episodeNum} of Season ${seasonNum}`,
      releaseAt,
      coverUrl: null,
    });
    created.episode = true;
    revalidateTag("episodes", { expire: 0 });
  }

  return NextResponse.json({
    ok: true,
    created,
    video: { id: video.id, name: video.name, tag: video.tag, type: video.type },
    season: { id: season.id, seasonNum: season.seasonNum },
    episode: {
      id: episode.id,
      episodeNum: episode.episodeNum,
      title: episode.title,
    },
  });
}
