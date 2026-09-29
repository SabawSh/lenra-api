import { NextResponse } from "next/server";

import {
  logContentImport,
  mysqlErrorMeta,
} from "@/lib/admin/contentImportDebug";
import {
  applyTestEpisodeContentReset,
  EpisodeContentResetBlockedError,
  previewTestEpisodeContentReset,
} from "@/lib/content-refresh/safeTestEpisodeContentReset";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

type ResetBody = {
  episodeId?: unknown;
  dryRun?: unknown;
  confirm?: unknown;
  confirmDiscardLearnerProgress?: unknown;
};

function parseBody(body: unknown): {
  episodeId: string;
  dryRun: boolean;
  confirm: boolean;
  confirmDiscardLearnerProgress: boolean;
} {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected JSON object body");
  }
  const doc = body as ResetBody;
  const episodeId = String(doc.episodeId ?? "").trim();
  if (!episodeId) {
    throw new Error("episodeId is required");
  }
  const dryRun = doc.dryRun !== false;
  const confirm =
    doc.confirm === true || String(doc.confirm ?? "").toLowerCase() === "true";
  const confirmDiscardLearnerProgress =
    doc.confirmDiscardLearnerProgress === true ||
    String(doc.confirmDiscardLearnerProgress ?? "").toLowerCase() === "true";
  return { episodeId, dryRun, confirm, confirmDiscardLearnerProgress };
}

/**
 * POST /api/admin/content-import/episode/reset
 * Body: { episodeId, dryRun?: true, confirm?: true, confirmDiscardLearnerProgress?: true }
 *
 * dryRun defaults to true. Set dryRun=false and confirm=true to apply.
 */
export async function POST(req: Request) {
  let episodeId = "";
  try {
    const denied = await assertMediaUploadAllowed(req);
    if (denied) return denied;

    const body = await req.json();
    const parsed = parseBody(body);
    episodeId = parsed.episodeId;

    logContentImport("episode-reset", "request", parsed);

    const resetOptions = parsed.confirmDiscardLearnerProgress
      ? { confirmDiscardLearnerProgress: true as const }
      : {};

    if (parsed.dryRun) {
      const preview = await previewTestEpisodeContentReset(
        episodeId,
        undefined,
        resetOptions,
      );
      logContentImport("episode-reset", "dry-run", {
        episodeId,
        allowed: preview.allowed,
        parts: preview.counts.willDeleteParts,
      });
      return NextResponse.json({ ok: true, ...preview });
    }

    if (!parsed.confirm) {
      return jsonError(
        400,
        "confirm=true is required when dryRun=false (destructive test reset)",
        { episodeId },
      );
    }

    const result = await applyTestEpisodeContentReset(
      episodeId,
      undefined,
      resetOptions,
    );
    logContentImport("episode-reset", "applied", {
      episodeId,
      partsDeleted: result.partsDeleted,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof EpisodeContentResetBlockedError) {
      logContentImport(
        "episode-reset",
        "blocked",
        { episodeId, blockers: error.preview.learnerProgressBlockers },
        "warn",
      );
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          ...error.preview,
        },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const meta = mysqlErrorMeta(error);
    logContentImport(
      "episode-reset",
      "failed",
      { episodeId, message, ...meta },
      "error",
    );
    return jsonError(500, message, {
      episodeId,
      mysqlCode: meta.code,
      detail: meta.sqlMessage,
    });
  }
}
