import { pool } from "@/lib/db/connection";
import {
  fetchPartRowById,
  fetchPartTranslations,
  findSeasonIdByVideoAndSeasonNum,
  findEpisodeIdBySeasonAndEpisodeNum,
  findPartByOrderWithTranslations,
} from "@/lib/db/queries/videos";
import {
  LANDING_DEMO_EPISODE_NUM,
  LANDING_DEMO_PART_ID,
  LANDING_DEMO_PART_ORDER,
  LANDING_DEMO_SEASON_NUM,
  LANDING_DEMO_VIDEO_TAG,
} from "@/lib/landing/demoConfig";
import { buildFallbackDemoPart, withBundledDemoVideo } from "@/lib/landing/fallbackDemoPart";
import type { Part } from "@/types/video";
import type { RowDataPacket } from "mysql2";

export type LandingDemoContent = {
  part: Part;
  videoTitle: string;
  episodeLabel: string;
  source: "db" | "fallback";
};

async function findVideoIdByTag(tag: string): Promise<string | null> {
  type R = RowDataPacket & { id: string };
  const [rows] = await pool.execute<R[]>(
    `
    SELECT CAST(id AS CHAR) AS id
    FROM videos
    WHERE tag = ? OR LOWER(name) = LOWER(?)
    LIMIT 1
    `,
    [tag, tag],
  );
  return rows[0]?.id ?? null;
}

async function loadCuratedPartFromDb(): Promise<LandingDemoContent | null> {
  const videoId = await findVideoIdByTag(LANDING_DEMO_VIDEO_TAG);
  if (!videoId) return null;

  const seasonId = await findSeasonIdByVideoAndSeasonNum(
    videoId,
    LANDING_DEMO_SEASON_NUM,
  );
  if (!seasonId) return null;

  const episodeId = await findEpisodeIdBySeasonAndEpisodeNum(
    seasonId,
    LANDING_DEMO_EPISODE_NUM,
  );
  if (!episodeId) return null;

  const part = await findPartByOrderWithTranslations({
    episodeId,
    order: LANDING_DEMO_PART_ORDER,
  });
  if (!part?.text || !part.tokens?.length) return null;

  type MetaR = RowDataPacket & { video_name: string; episode_num: number };
  const [metaRows] = await pool.execute<MetaR[]>(
    `
    SELECT v.name AS video_name, e.episode_num
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    INNER JOIN videos v ON v.id = s.video_id
    WHERE e.id = ?
    LIMIT 1
    `,
    [episodeId],
  );
  const meta = metaRows[0];

  return {
    part: withBundledDemoVideo(part),
    videoTitle: meta?.video_name ?? "Friends",
    episodeLabel: `S${String(LANDING_DEMO_SEASON_NUM).padStart(2, "0")}E${String(meta?.episode_num ?? LANDING_DEMO_EPISODE_NUM).padStart(2, "0")}`,
    source: "db",
  };
}

async function loadPartById(partId: string): Promise<LandingDemoContent | null> {
  const part = await fetchPartRowById(partId);
  if (!part?.text) return null;
  const translations = await fetchPartTranslations(partId);

  type ScopeR = RowDataPacket & {
    video_name: string;
    season_num: number;
    episode_num: number;
  };
  const [scopeRows] = await pool.execute<ScopeR[]>(
    `
    SELECT v.name AS video_name, s.season_num, e.episode_num
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    INNER JOIN videos v ON v.id = s.video_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [partId],
  );
  const scope = scopeRows[0];

  return {
    part: withBundledDemoVideo({ ...part, translations }),
    videoTitle: scope?.video_name ?? "Lenra",
    episodeLabel: scope
      ? `S${String(scope.season_num).padStart(2, "0")}E${String(scope.episode_num).padStart(2, "0")}`
      : "",
    source: "db",
  };
}

export async function getLandingDemoContent(): Promise<LandingDemoContent> {
  try {
    if (LANDING_DEMO_PART_ID) {
      const byId = await loadPartById(LANDING_DEMO_PART_ID);
      if (byId) return byId;
    }

    const curated = await loadCuratedPartFromDb();
    if (curated) return curated;
  } catch (err) {
    console.warn("[landing-demo] DB lookup failed, using fallback part", err);
  }

  return {
    part: withBundledDemoVideo(buildFallbackDemoPart()),
    videoTitle: "Friends",
    episodeLabel: "S01E02",
    source: "fallback",
  };
}
