import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { pool } from "@/lib/db/connection";
import {
  JOIN_EPISODE_ON_CATALOG,
  JOIN_VIDEO_ON_CATALOG,
} from "@/lib/db/sql/partCatalog";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Resolve playable clip media for a part (movie context) without requiring
 * a saved_vocabulary_cards row. Used by My Words flashcard “Watch context”.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const partId = url.searchParams.get("partId")?.trim() ?? "";
    if (!partId) {
      return NextResponse.json({ error: "partId_required" }, { status: 400 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        CAST(p.id AS CHAR) AS part_id,
        p.text AS sentence,
        p.video_url AS clip_url,
        p.hls_manifest_url AS clip_hls_manifest_url,
        (
          SELECT ct.text FROM caption_translations ct
          WHERE ct.part_id = p.id AND ct.language = 'fa'
          ORDER BY ct.id ASC LIMIT 1
        ) AS translation,
        COALESCE(e.cover_url, s.cover_url, v.cover_url) AS preview_image_url,
        pc.video_name AS movie_title,
        e.title AS episode_title,
        pc.season_num AS season_num,
        pc.episode_num AS episode_num
      FROM parts p
      LEFT JOIN part_catalog pc
        ON pc.part_id COLLATE utf8mb4_unicode_ci = p.id
      LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
      LEFT JOIN seasons s ON s.id = pc.season_id
      LEFT JOIN videos v ON ${JOIN_VIDEO_ON_CATALOG("pc", "v")}
      WHERE p.id = ?
      LIMIT 1
      `,
      [partId],
    );

    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "clip_not_found" }, { status: 404 });
    }

    const clipUrl =
      row.clip_url != null && String(row.clip_url).trim() !== ""
        ? String(row.clip_url).trim()
        : "";
    const clipHlsManifestUrl =
      row.clip_hls_manifest_url != null &&
      String(row.clip_hls_manifest_url).trim() !== ""
        ? String(row.clip_hls_manifest_url).trim()
        : null;

    if (!clipUrl && !clipHlsManifestUrl) {
      return NextResponse.json(
        { error: "media_unavailable", partId },
        { status: 404 },
      );
    }

    return NextResponse.json({
      partId: String(row.part_id),
      clipUrl,
      clipHlsManifestUrl,
      sentence: row.sentence != null ? String(row.sentence) : "",
      translation: row.translation != null ? String(row.translation) : null,
      previewImageUrl:
        row.preview_image_url != null ? String(row.preview_image_url) : null,
      movieTitle: row.movie_title != null ? String(row.movie_title) : null,
      episodeTitle: row.episode_title != null ? String(row.episode_title) : null,
      seasonNum: row.season_num != null ? Number(row.season_num) : null,
      episodeNum: row.episode_num != null ? Number(row.episode_num) : null,
    });
  } catch (err) {
    console.error("[learning] clip-playback error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
