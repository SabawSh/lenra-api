import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { patchVideoScalars } from "@/lib/db/queries/videos";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * POST /api/admin/update-video-meta
 * Body: {
 *   id: string;
 *   levels?: string[];
 *   level?: string | null; // legacy single value
 *   genres?: string[];
 *   isNew?: boolean;
 *   imdbRating?: number | null;
 *   isLiked?: boolean;
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
    levels?: string[];
    genres?: string[];
    isNew?: boolean;
    imdbRating?: number | null;
    isLiked?: boolean;
    releaseAt?: Date;
  } = {};

  if ("levels" in (record ?? {})) {
    data.levels = parseStringArray(record?.levels);
  } else if ("level" in (record ?? {})) {
    const raw = record?.level;
    data.levels =
      raw === null || raw === ""
        ? []
        : typeof raw === "string"
          ? [raw.trim()]
          : [];
  }

  if (Array.isArray(record?.genres)) {
    data.genres = parseStringArray(record.genres);
  }

  if (typeof record?.isNew === "boolean") {
    data.isNew = record.isNew;
  }

  if (typeof record?.isLiked === "boolean") {
    data.isLiked = record.isLiked;
  }

  if ("imdbRating" in (record ?? {})) {
    const raw = record?.imdbRating;
    if (raw === null) {
      data.imdbRating = null;
    } else {
      const num = typeof raw === "string" ? parseFloat(raw) : Number(raw);
      if (!isNaN(num) && num >= 0 && num <= 10) {
        data.imdbRating = Math.round(num * 10) / 10;
      }
    }
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

  const ok = await patchVideoScalars(id, data);
  if (!ok) {
    return NextResponse.json(
      { error: "Video not found or update failed" },
      { status: 404 },
    );
  }
  revalidateTag("videos", { expire: 0 });
  return NextResponse.json({ ok: true });
}
