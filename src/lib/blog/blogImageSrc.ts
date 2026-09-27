/** Hosts where Next.js image optimization cannot fetch (private / loopback). */
export function shouldUseUnoptimizedBlogImage(src: string): boolean {
  try {
    const u = new URL(src);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return true;
    }
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}
