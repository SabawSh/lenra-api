import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { cacheControlForHlsObject } from "@/lib/media/hls/cacheHeaders";
import {
  buildMediaPublicUrl,
  createMediaS3Client,
  presignMediaPut,
  presignedPutUploadHeaders,
} from "@/lib/storage/cloud-s3";
import {
  buildHlsCatalogPackagePath,
  buildHlsUploadKey,
  type HlsCatalogLayoutKind,
} from "@/lib/storage/hlsUploadKey";
import {
  buildStructuredLeafName,
  buildStructuredUploadKey,
  slugContentTitle,
  type UploadKindKey,
} from "@/lib/storage/mediaUploadKey";
import { assertMediaUploadAllowed } from "@/lib/storage/upload-auth";

type PresignKind = UploadKindKey | "hls";

function parseUploadKind(value: any | undefined): PresignKind {
  if (
    value === "cover" ||
    value === "clip" ||
    value === "misc" ||
    value === "hls"
  ) {
    return value;
  }
  return "misc";
}

const MIME_ALLOWLIST: Record<PresignKind, RegExp> = {
  cover: /^image\/(jpeg|pjpeg|png|webp)$/i,
  clip: /^video\/(mp4|quicktime|webm)$/i,
  hls: /^application\/(vnd\.apple\.mpegurl|x-mpegurl)|^video\/mp2t|^application\/octet-stream$/i,
  misc: /^image\/(jpeg|pjpeg|png|webp)|^video\/(mp4|quicktime|webm)|^audio\/(mpeg|mp4|webm)$/i,
};

function sniffContentTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mpeg": "audio/mpeg",
    ".mp3": "audio/mpeg",
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
  };
  return map[ext] ?? "";
}

function coerceInt(
  v: any | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(max, Math.max(min, Math.floor(v)));
  }
  if (
    typeof v === "string" &&
    v.trim() &&
    !Number.isNaN(Number.parseInt(v, 10))
  ) {
    const n = Number.parseInt(v, 10);
    return Math.min(max, Math.max(min, n));
  }
  return fallback;
}

function parseHlsLayout(
  body: Record<string, any>,
  season: number,
  episode: number,
): HlsCatalogLayoutKind {
  const raw =
    typeof body.catalogLayout === "string"
      ? body.catalogLayout.trim().toLowerCase()
      : typeof body.videoLayout === "string"
        ? body.videoLayout.trim().toLowerCase()
        : "";
  if (raw === "series" || raw === "standalone") return raw;
  if (season >= 1 && episode >= 1) return "series";
  return "standalone";
}

function readPublicRead(body: Record<string, any>): boolean {
  if (typeof body.publicRead === "boolean") return body.publicRead;
  const s =
    typeof body.publicRead === "string"
      ? body.publicRead.trim().toLowerCase()
      : "";
  if (s === "false" || s === "0") return false;
  return true;
}

/**
 * POST /api/media/presign
 *
 * Leaf pattern: `{uuid}_{titleSlug}_S{ss}_E{ee}_P{ppp}_{safeFilename}`
 * Body JSON: kind, filename, relativeDirectory, contentType?,
 * contentTitle?, season?, episode?, part?,
 * publicRead? (default true — signs PutObject ACL public-read where supported).
 */
export async function POST(req: Request) {
  const denied = await assertMediaUploadAllowed(req);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, any>)
      : {};
  const kind = parseUploadKind(b.kind);
  const filenameRaw = typeof b.filename === "string" ? b.filename : "upload";

  let contentType =
    typeof b.contentType === "string" && b.contentType.trim()
      ? b.contentType.trim()
      : sniffContentTypeFromFilename(filenameRaw);

  const relativeDirectory =
    typeof b.relativeDirectory === "string" ? b.relativeDirectory.trim() : "";

  if (!contentType) {
    return NextResponse.json(
      { error: "Could not infer contentType; pass contentType explicitly" },
      { status: 400 },
    );
  }

  if (
    /^application\/octet-stream$/i.test(contentType) ||
    /^binary\/octet-stream$/i.test(contentType)
  ) {
    const sniffed = sniffContentTypeFromFilename(filenameRaw);
    if (sniffed) {
      contentType = sniffed;
    }
  }

  if (!MIME_ALLOWLIST[kind].test(contentType)) {
    return NextResponse.json(
      { error: `contentType not allowed for kind "${kind}"` },
      { status: 400 },
    );
  }

  const season = coerceInt(b.season, 0, 99, 0);
  const episode = coerceInt(b.episode, 0, 99, 0);
  const part = coerceInt(b.part, 0, 999, 0);

  let key: string;
  let naming: Record<string, unknown>;

  if (kind === "hls") {
    const contentTitleRaw =
      typeof b.contentTitle === "string" && b.contentTitle.trim()
        ? b.contentTitle.trim()
        : "media";
    const localFolderName =
      typeof b.localFolderName === "string" && b.localFolderName.trim()
        ? b.localFolderName.trim()
        : typeof b.videoId === "string"
          ? b.videoId.trim()
          : "clip";
    const hlsRelative =
      typeof b.hlsRelativePath === "string"
        ? b.hlsRelativePath.trim()
        : filenameRaw;
    const layout = parseHlsLayout(b, season, episode);
    const catalogPackagePath = buildHlsCatalogPackagePath({
      contentTitle: contentTitleRaw,
      layout,
      season,
      episode,
      part,
      localFolderName,
    });
    if (!catalogPackagePath) {
      return NextResponse.json(
        {
          error:
            layout === "series"
              ? "Invalid HLS path (series needs season ≥ 1 and episode ≥ 1)"
              : "Invalid HLS package naming (check title, part, folder name)",
        },
        { status: 400 },
      );
    }
    const built = buildHlsUploadKey(catalogPackagePath, hlsRelative);
    if (!built) {
      return NextResponse.json(
        { error: "Invalid hlsRelativePath for HLS upload" },
        { status: 400 },
      );
    }
    key = built;
    naming = {
      pattern:
        layout === "series"
          ? "hls/{title}/S{season}/E{episode}/P{part}/{folder}/{relativePath}"
          : "hls/{title}/P{part}/{folder}/{relativePath}",
      catalogLayout: layout,
      catalogPackagePath,
      localFolderName,
      hlsRelative,
    };
  } else {
    const uuid = randomUUID();
    const contentTitleRaw =
      typeof b.contentTitle === "string" && b.contentTitle.trim()
        ? b.contentTitle.trim()
        : "media";
    /** Keep raw for client skip matching — server slug must match slugContentTitle. */
    const titleSlugEcho = slugContentTitle(contentTitleRaw);

    const leaf = buildStructuredLeafName({
      uuid,
      titleSlug: contentTitleRaw,
      season,
      episode,
      part,
      sanitizedFilename: filenameRaw,
    });
    key = buildStructuredUploadKey(kind, relativeDirectory, leaf);
    naming = {
      pattern: `{uuid}_${titleSlugEcho}_S{season}_E{episode}_P{part}_{filename}`,
      uuid,
      titleSlug: titleSlugEcho,
      season,
      episode,
      part,
    };
  }

  const publicRead = readPublicRead(b);
  const expiresInSeconds = 3600;
  const hlsCacheControl =
    kind === "hls" ? cacheControlForHlsObject(filenameRaw) : undefined;

  try {
    const client = createMediaS3Client();
    const uploadUrl = await presignMediaPut(
      client,
      key,
      contentType,
      expiresInSeconds,
      {
        publicRead,
        cacheControl: hlsCacheControl,
      },
    );
    const publicUrl = buildMediaPublicUrl(key);

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
      bucket: process.env.CLOUD_BUCKET_NAME,
      expiresInSeconds,
      /** Send on the client PUT; required for public-read when ACL is in the presign. */
      uploadHeaders: presignedPutUploadHeaders(
        contentType,
        publicRead,
        hlsCacheControl,
      ),
      naming,
      publicRead,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Presign failed";
    console.error("[media/presign]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
