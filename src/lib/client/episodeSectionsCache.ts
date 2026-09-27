export const episodeSectionsCacheKey = (episodeId: string) =>
  `episode-sections-state:${episodeId}`;

export function invalidateEpisodeSectionsCache(episodeId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(episodeSectionsCacheKey(episodeId));
  } catch {
    /* non-fatal */
  }
}
