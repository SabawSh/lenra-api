/** Cache-Control for VOD HLS objects on CDN / S3 (Safari relies on HTTP cache for segments). */

export function cacheControlForHlsObject(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".m3u8")) {
    return "public, max-age=60";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".m4s")) {
    return "public, max-age=31536000, immutable";
  }
  return undefined;
}
