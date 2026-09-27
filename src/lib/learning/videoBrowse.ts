import type { VideoType } from "@/types/schema";

/** Detail/browse path for a catalog video (series season tree vs standalone title). */
export function videoBrowseHref(video: { id: string; type: VideoType }): string {
  if (video.type === "series") return `/series/${video.id}`;
  return `/movies/${video.id}/sections`;
}
