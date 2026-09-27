import { resolvePublicMediaUrl } from "@/lib/media/resolvePublicMediaUrl";

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export function sanitizeVideoId(videoId: string): string | null {
  const trimmed = videoId.trim();
  if (!VIDEO_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Browser/CDN path served from `public/media/hls`. */
export function hlsPublicPath(videoId: string, relative = "master.m3u8"): string {
  const safe = sanitizeVideoId(videoId);
  if (!safe) {
    throw new Error(`Invalid videoId: ${videoId}`);
  }
  const normalized = relative.replace(/^\/+/, "");
  return `/media/hls/${safe}/${normalized}`;
}

export function resolveHlsPublicUrl(
  videoId: string,
  relative = "master.m3u8",
): string {
  return resolvePublicMediaUrl(hlsPublicPath(videoId, relative));
}

/**
 * S3/CDN key prefix (upload scripts): `hls/{catalogPath}/…`
 * `catalogPath` may be multi-segment (`friends/S01/E05/P003/clip1`).
 */
export function hlsCdnKeyPrefix(catalogPath: string): string {
  const segments = catalogPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid HLS catalog path: ${catalogPath}`);
  }
  for (const seg of segments) {
    const safe = sanitizeVideoId(seg);
    if (!safe) {
      throw new Error(`Invalid HLS path segment: ${seg}`);
    }
  }
  return `hls/${segments.join("/")}`;
}
