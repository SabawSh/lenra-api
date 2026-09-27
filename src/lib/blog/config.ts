
/** Base URL for the Blog CMS public API (no trailing slash). */
export function getBlogApiBaseUrl(): string | null {
  const raw =
    typeof process.env.BLOG_API_URL === "string"
      ? process.env.BLOG_API_URL.trim()
      : "";
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function blogApiConfigured(): boolean {
  return getBlogApiBaseUrl() != null;
}
