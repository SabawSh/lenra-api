import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  updateEpisodeCoverUrl,
  updateSeasonCoverUrl,
  updateVideoCoverUrl,
} from "@/lib/db/queries/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

type CoverTargetType = "video" | "season" | "episode";

function isCoverTargetType(value: unknown): value is CoverTargetType {
  return value === "video" || value === "season" || value === "episode";
}

/**
 * POST /api/admin/update-cover
 * Body: { targetType, id, coverUrl }
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  const targetType = record?.targetType;
  const id = typeof record?.id === "string" ? record.id.trim() : "";
  const coverUrl =
    typeof record?.coverUrl === "string" ? record.coverUrl.trim() : "";

  if (!isCoverTargetType(targetType) || !id || !coverUrl) {
    return NextResponse.json(
      { error: "targetType, id, and coverUrl are required" },
      { status: 400 },
    );
  }

  let ok = false;
  if (targetType === "video") {
    ok = await updateVideoCoverUrl(id, coverUrl);
    if (ok) revalidateTag("videos", { expire: 0 });
  } else if (targetType === "season") {
    ok = await updateSeasonCoverUrl(id, coverUrl);
    if (ok) revalidateTag("seasons", { expire: 0 });
  } else {
    ok = await updateEpisodeCoverUrl(id, coverUrl);
    if (ok) revalidateTag("episodes", { expire: 0 });
  }
  if (!ok) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
