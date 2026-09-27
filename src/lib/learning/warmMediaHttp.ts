/**
 * Best-effort CDN warm: opens a no-cors GET so the browser can establish
 * connection / cache before the main `<video>` requests the same URL.
 */
export function warmMediaHttpBytes(urls: readonly string[]): void {
  for (const href of urls) {
    if (!href || !/^https?:\/\//i.test(href)) continue;
    void fetch(href, { mode: "no-cors", cache: "default" }).catch(() => {});
  }
}
