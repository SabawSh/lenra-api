import { NextResponse } from "next/server";

import { getVideos } from "@/lib/db/videos";
import {
  listEpisodesAscBySeasonId,
  listSeasonsAscByVideoId,
} from "@/lib/db/queries/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

/**
 * GET /api/admin/content-catalog
 * Full video → season → episode tree for content-pipeline CMS.
 * Auth: Bearer API_INTERNAL_SECRET / CLOUD_UPLOAD_API_KEY (or site media admin session).
 */
export async function GET(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const videos = await getVideos();
  const catalog = await Promise.all(
    videos.map(async (video) => {
      const seasonRows = await listSeasonsAscByVideoId(video.id);
      const seasons = await Promise.all(
        seasonRows.map(async (season) => {
          const episodeRows = await listEpisodesAscBySeasonId(season.id);
          return {
            id: season.id,
            seasonNum: season.seasonNum,
            coverUrl: season.coverUrl ?? null,
            episodes: episodeRows.map((episode) => ({
              id: episode.id,
              episodeNum: episode.episodeNum,
              title: episode.title,
              coverUrl: episode.coverUrl ?? null,
              releaseAt:
                episode.releaseAt instanceof Date
                  ? episode.releaseAt.toISOString()
                  : episode.releaseAt
                    ? String(episode.releaseAt)
                    : null,
            })),
          };
        }),
      );

      return {
        id: video.id,
        name: video.name,
        type: video.type,
        tag: video.tag,
        coverUrl: video.coverUrl ?? null,
        description: video.description ?? null,
        seasons,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    videos: catalog,
    count: catalog.length,
  });
}
