import { NextResponse } from "next/server";

import {
  getEpisodeImportContext,
  logContentImport,
  mysqlErrorMeta,
} from "@/lib/admin/contentImportDebug";
import {
  getEpisodeContentOverview,
  getPartLearningDetail,
  listEpisodePartSummaries,
} from "@/lib/content-import";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/**
 * GET /api/admin/content-import/episode?episodeId=&view=overview|parts|part&partId=&limit=&offset=
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const episodeId = url.searchParams.get("episodeId")?.trim() ?? "";
  const view = url.searchParams.get("view")?.trim() ?? "overview";
  const partId = url.searchParams.get("partId")?.trim() ?? "";

  logContentImport("episode", "request", { episodeId, view, partId });

  try {
    const denied = await assertMediaUploadAllowed(req);
    if (denied) return denied;

    if (view === "part") {
      if (!partId) {
        return jsonError(400, "partId is required for view=part");
      }
      const detail = await getPartLearningDetail(partId);
      if (!detail) {
        logContentImport("episode", "part not found", { partId });
        return jsonError(404, "Part not found", { partId });
      }
      return NextResponse.json({ ok: true, detail });
    }

    if (!episodeId) {
      return jsonError(400, "episodeId is required");
    }

    let ctx;
    try {
      ctx = await getEpisodeImportContext(episodeId);
    } catch (dbErr) {
      const meta = mysqlErrorMeta(dbErr);
      logContentImport(
        "episode",
        "database lookup failed",
        { episodeId, ...meta },
        "error",
      );
      return jsonError(503, "Database lookup failed", {
        episodeId,
        detail: meta.sqlMessage ?? meta.code ?? "unknown",
      });
    }

    logContentImport("episode", "context", ctx);

    if (!ctx.episodeExists) {
      return jsonError(404, "Episode not found in database", {
        episodeId,
        partCount: ctx.partCount,
        schema: ctx.schema,
      });
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
      return NextResponse.json({
        ok: true,
        episode: {
          id: episodeId,
          title: ctx.episodeTitle,
          partCount: ctx.partCount,
        },
        parts,
      });
    }

    const overview = await getEpisodeContentOverview(episodeId);
    logContentImport("episode", "overview ok", {
      episodeId,
      partCount: overview.partCount,
    });
    return NextResponse.json({
      ok: true,
      episode: {
        id: episodeId,
        title: ctx.episodeTitle,
        exists: true,
      },
      schema: ctx.schema,
      overview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const meta = mysqlErrorMeta(error);
    logContentImport(
      "episode",
      "failed",
      { episodeId, view, message, ...meta },
      "error",
    );
    return jsonError(500, message, {
      episodeId,
      view,
      mysqlCode: meta.code,
      detail: meta.sqlMessage,
    });
  }
}
