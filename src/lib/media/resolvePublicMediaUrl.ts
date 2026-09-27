/**
 * Maps stored paths (/covers/…, /output_clips/…) to absolute CDN URLs when
 * `NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL` is set (typically same value as `CLOUD_PUBLIC_BASE_URL`:
 * bucket public root without a trailing slash).
 *
 * Designed for minimum overhead: synchronous string rewriting only — no GET round-trip.
 * Already-absolute URLs are returned unchanged so migrated DB rows keep working.
 *
 * **Redirects:** Prefer storing the final, stable CDN origin in the database. To rewrite
 * known legacy bucket hosts to the final CDN host without a 301 on first byte, set:
 * `NEXT_PUBLIC_MEDIA_URL_HOST_ALIASES` — comma- or semicolon-separated pairs
 * `legacy.host.example>final.host.example` (also accepts `legacy|final`).
 */
function cdnPublicBaseTrimmed(): string {
  const raw =
    typeof process.env.MEDIA_BASE_URL === "string"
      ? process.env.MEDIA_BASE_URL.trim()
      : "";
  return raw.replace(/\/$/, "");
}

/**
 * Optional: map absolute URL hostnames to the canonical CDN host to avoid 301 chains.
 * Example: `s3.ir-thr-at1.arvanstorage.ir>hot.ir-central1.arvanstorage.ir`
 */
export function rewriteAbsoluteMediaHostIfAliased(absoluteUrl: string): string {
  const raw =
    typeof process.env.NEXT_PUBLIC_MEDIA_URL_HOST_ALIASES === "string"
      ? process.env.NEXT_PUBLIC_MEDIA_URL_HOST_ALIASES.trim()
      : "";
  if (!raw || !/^https?:\/\//i.test(absoluteUrl)) {
    return absoluteUrl;
  }
  try {
    const u = new URL(absoluteUrl);
    for (const segment of raw.split(/[,;]/)) {
      const pair = segment.trim();
      if (!pair) continue;
      const parts = pair.split(/[>|]/).map((s) => s.trim());
      const from = parts[0];
      const to = parts[1];
      if (from && to && u.hostname === from) {
        u.hostname = to;
        return u.href;
      }
    }
  } catch {
    /* keep original */
  }
  return absoluteUrl;
}

const MEDIA_BASE_URL =
  process.env.NEXT_PUBLIC_MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
const MEDIA_HLS_PREFIX = process.env.MEDIA_HLS_PREFIX ?? "hls";
export function resolvePublicMediaUrl(path?: string | null): string {
  if (!path) return "";

  if (/^https?:\/\//i.test(path)) {
    return rewriteAbsoluteMediaHostIfAliased(path);
  }

  /** Bundled static assets under `public/landing/`. */
  if (path.startsWith("/landing/")) {
    return path;
  }

  const normalized = path.replace(/^\/+/, "");

  return `${MEDIA_BASE_URL}/${MEDIA_HLS_PREFIX}/${normalized}`;
}

/** Origin (scheme + host) of the CDN — for `<link rel="preconnect">` only. */
export function mediaCdnOriginForHints(): string | null {
  const base = cdnPublicBaseTrimmed();
  if (!base || !/^https?:\/\//i.test(base)) {
    return null;
  }
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}
