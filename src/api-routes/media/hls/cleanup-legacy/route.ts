import { NextResponse } from "next/server";

import {
  createMediaS3Client,
  deleteMediaObjectKeys,
  listLegacyHlsObjectKeys,
} from "@/lib/storage/cloud-s3";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

/**
 * POST /api/media/hls/cleanup-legacy
 * Body: { execute?: boolean } — default false (dry-run).
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let execute = false;
  try {
    const body = (await req.json()) as { execute?: boolean };
    execute = body?.execute === true;
  } catch {
    /* dry-run */
  }

  try {
    const client = createMediaS3Client();
    const keys = await listLegacyHlsObjectKeys(client);
    let deleted = 0;
    if (execute && keys.length > 0) {
      deleted = await deleteMediaObjectKeys(client, keys);
    }

    return NextResponse.json({
      ok: true,
      execute,
      found: keys.length,
      deleted,
      sample: keys.slice(0, 20),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cleanup failed";
    console.error("[media/hls/cleanup-legacy]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
