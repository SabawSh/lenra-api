import { NextResponse } from "next/server";

import { cacheControlForHlsObject } from "@/lib/media/hls/cacheHeaders";
import {
  buildMediaPublicUrl,
  putMediaObject,
  sanitizeMediaObjectKey,
} from "@/lib/storage/cloud-s3";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/media/put
 * Streams file body to Arvan S3 with public-read ACL (admin only).
 * Avoids browser CORS on direct presigned PUT.
 *
 * Headers:
 * - Content-Type (required)
 * - X-Media-Object-Key (required) — S3 key from presign response
 * - X-Media-Cache-Control (optional)
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  const rawKey = req.headers.get("x-media-object-key")?.trim() ?? "";
  const key = sanitizeMediaObjectKey(rawKey);
  if (!key) {
    return NextResponse.json(
      { error: "Invalid X-Media-Object-Key" },
      { status: 400 },
    );
  }

  const contentType =
    req.headers.get("content-type")?.trim() || "application/octet-stream";

  const cacheControl =
    req.headers.get("x-media-cache-control")?.trim() ||
    cacheControlForHlsObject(key.split("/").pop() ?? "") ||
    undefined;

  try {
    const raw = await req.arrayBuffer();
    if (raw.byteLength === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    await putMediaObject(key, raw, contentType, {
      publicRead: true,
      cacheControl,
    });

    return NextResponse.json({
      ok: true,
      key,
      publicUrl: buildMediaPublicUrl(key),
      publicRead: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[media/put]", key, e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
