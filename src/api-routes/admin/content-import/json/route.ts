import { NextResponse } from "next/server";

import { ContentImportRunTimer, logContentImport } from "@/lib/admin/contentImportDebug";
import {
  contentImportErrorResponse,
  isContentImportDryRun,
  parseJsonContentImportBody,
  runContentImportFromParsed,
} from "@/lib/admin/contentImportRequest";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";
/** Next.js/Vercel only — ignored when this handler runs under lenra-api (Hono). */
export const maxDuration = 300;

/**
 * POST /api/admin/content-import/json
 * application/json body with episodeId, mode, confirmReplace?, artifacts{...}
 * query: ?dryRun=1 for preview only
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = isContentImportDryRun(url);

  const contentLength = req.headers.get("content-length");
  const requestTimer = new ContentImportRunTimer("pending", dryRun);
  logContentImport("json", "request", {
    dryRun,
    contentLength,
    contentType: req.headers.get("content-type")?.split(";")[0],
  });

  try {
    const denied = await assertMediaUploadAllowed(req);
    if (denied) return denied;

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        {
          ok: false,
          error: "Expected application/json body",
          stage: dryRun ? "validation" : "import",
        },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (parseErr) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      logContentImport("json", "json parse failed", { message, contentLength });
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid JSON body",
          detail: message,
          stage: dryRun ? "validation" : "import",
        },
        { status: 400 },
      );
    }

    const parsed = parseJsonContentImportBody(body);
    requestTimer.phase("json-parsed", {
      episodeId: parsed.episodeId,
      mode: parsed.mode,
      bytesByField: parsed.bytesByField,
    });

    return await runContentImportFromParsed({
      dryRun,
      logScope: "json",
      contentLength,
      parsed,
      requestTimer,
    });
  } catch (error) {
    return contentImportErrorResponse(error, dryRun, contentLength, "json");
  }
}
