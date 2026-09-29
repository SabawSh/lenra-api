import { NextResponse } from "next/server";

import {
  getEpisodeContentOverview,
  getPartLearningDetail,
  listEpisodePartSummaries,
} from "@/lib/content-import";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/content-import/episode?episodeId=&view=overview|parts|part&partId=&limit=&offset=
 */
export async function GET(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const episodeId = url.searchParams.get("episodeId")?.trim() ?? "";
  const view = url.searchParams.get("view")?.trim() ?? "overview";
  const partId = url.searchParams.get("partId")?.trim() ?? "";

  try {
    if (view === "part") {
      if (!partId) {
        return NextResponse.json(
          { error: "partId is required for view=part" },
          { status: 400 },
        );
      }
      const detail = await getPartLearningDetail(partId);
      if (!detail) {
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, detail });
    }

    if (!episodeId) {
      return NextResponse.json(
        { error: "episodeId is required" },
        { status: 400 },
      );
    }

    if (view === "parts") {
      const limit = Math.min(
        500,
        Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100),
      );
      const offset = Math.max(
        0,
        Number(url.searchParams.get("offset") ?? 0) || 0,
      );
      const parts = await listEpisodePartSummaries(episodeId, limit, offset);
      return NextResponse.json({ ok: true, parts });
    }

    const overview = await getEpisodeContentOverview(episodeId);
    return NextResponse.json({ ok: true, overview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[content-import/episode]", view, episodeId, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
