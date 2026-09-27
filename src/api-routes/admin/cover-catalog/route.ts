import { NextResponse } from "next/server";

import {
  listEpisodesAscBySeasonId,
  listSeasonsAscByVideoId,
} from "@/lib/db/queries/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

/**
 * GET /api/admin/cover-catalog?videoId=...
 * Seasons (with episodes) for cover admin UI.
 */
export async function GET(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const videoId = new URL(req.url).searchParams.get("videoId")?.trim();
  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  const seasonRows = await listSeasonsAscByVideoId(videoId);
  const seasons = await Promise.all(
    seasonRows.map(async (s) => ({
      ...s,
      episodes: await listEpisodesAscBySeasonId(s.id),
    })),
  );
  const episodes = seasons.flatMap((season) => season.episodes);

  return NextResponse.json({ seasons, episodes });
}
