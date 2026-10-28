import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { patchEpisodeScalars } from "@/lib/db/queries/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

/**
 * POST /api/admin/update-episode-meta
 * Body: {
 *   id: string;
 *   title?: string;
 *   description?: string | null;
 *   releaseAt?: string; // ISO date string
 * }
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

  const id = typeof record?.id === "string" ? record.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const data: {
    title?: string;
    description?: string | null;
    releaseAt?: Date;
  } = {};

  if (typeof record?.title === "string" && record.title.trim()) {
    data.title = record.title.trim();
  }

  if ("description" in (record ?? {})) {
    const raw = record?.description;
    data.description =
      raw === null || raw === undefined
        ? null
        : typeof raw === "string"
          ? raw
          : String(raw);
  }

  if (typeof record?.releaseAt === "string" && record.releaseAt.trim()) {
    const d = new Date(record.releaseAt);
    if (!isNaN(d.getTime())) data.releaseAt = d;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one field to update" },
      { status: 400 },
    );
  }

  const ok = await patchEpisodeScalars(id, data);
  if (!ok) {
    return NextResponse.json(
      { error: "Episode not found or update failed" },
      { status: 404 },
    );
  }
  revalidateTag("episodes", { expire: 0 });
  return NextResponse.json({ ok: true });
}
