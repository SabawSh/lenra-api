import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  applyClipHlsManifestUrl,
  applyClipPublicUrl,
  applyCoverPublicUrl,
} from "@/lib/media/applyCdnUrlsToDb";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

const MEDIA_HLS_PREFIX =
  process.env.MEDIA_HLS_PREFIX?.replace(/^\/|\/$/g, "") ?? "hls";

export function normalizeHlsStoragePath(url: string): string {
  try {
    const u = new URL(url);

    const marker = `/${MEDIA_HLS_PREFIX}/`;

    const idx = u.pathname.indexOf(marker);

    if (idx >= 0) {
      return u.pathname.slice(idx + marker.length);
    }

    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url;
  }
}

function coerceSmallInt(
  value: any | undefined,
  fallback: number,
  max = 99,
): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/**
 * PATCH DB cover / clip URLs after CDN upload — same auth as `/api/media/presign`.
 * Body JSON: `{ commits: Commit[] }` where each Commit is:
 * `{ kind:"clip"|"cover"|"hls", publicUrl, contentTitle, season?, episode?, part? }`
 * Season/episode 0 usually means “not applicable”; series clips must set episode &gt; 0.
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let raw;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, any>)
      : {};
  const commits = Array.isArray(body.commits) ? body.commits : null;
  if (!commits?.length) {
    return NextResponse.json({ error: "commits[] required" }, { status: 400 });
  }

  const results: {
    index: number;
    kind: "clip" | "cover" | string | null;
    ok: boolean;
    reason?: string;
  }[] = [];

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i] as any;
    const row =
      c && typeof c === "object" && !Array.isArray(c)
        ? (c as Record<string, any>)
        : {};
    const kind =
      row.kind === "cover"
        ? "cover"
        : row.kind === "clip"
          ? "clip"
          : row.kind === "hls"
            ? "hls"
            : null;
    const publicUrl =
      typeof row.publicUrl === "string" ? row.publicUrl.trim() : "";
    const contentTitle =
      typeof row.contentTitle === "string" ? row.contentTitle.trim() : "";
    const season = coerceSmallInt(row.season, 0);
    const episode = coerceSmallInt(row.episode, 0);
    const part = coerceSmallInt(row.part, 1, 999);

    if (!kind || !publicUrl || !contentTitle) {
      results.push({
        index: i,
        kind: typeof row.kind === "string" ? row.kind : null,
        ok: false,
        reason:
          "kind (clip|cover|hls), publicUrl and contentTitle are required",
      });
      continue;
    }
    const normalizedPublicUrl = normalizeHlsStoragePath(publicUrl);
    if (kind === "clip") {
      const r = await applyClipPublicUrl({
        publicUrl: normalizedPublicUrl,
        contentTitle,
        seasonNum: season,
        episodeNum: episode,
        partOrder: part,
      });
      results.push(
        r.ok
          ? { index: i, kind, ok: true }
          : { index: i, kind, ok: false, reason: r.reason },
      );
    } else if (kind === "hls") {
      const r = await applyClipHlsManifestUrl({
        publicUrl: normalizedPublicUrl,
        contentTitle,
        seasonNum: season,
        episodeNum: episode,
        partOrder: part,
      });
      results.push(
        r.ok
          ? { index: i, kind, ok: true }
          : { index: i, kind, ok: false, reason: r.reason },
      );
    } else {
      const r = await applyCoverPublicUrl({
        publicUrl,
        contentTitle,
        seasonNum: season,
        episodeNum: episode,
      });
      results.push(
        r.ok
          ? { index: i, kind, ok: true }
          : { index: i, kind, ok: false, reason: r.reason },
      );
    }
  }

  const failed = results.filter((r: { ok: boolean }) => !r.ok);
  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    revalidateTag("videos", { expire: 0 });
    revalidateTag("episodes", { expire: 0 });
  }
  return NextResponse.json({
    results,
    ok: failed.length === 0,
  });
}
