import { invalidateEpisodeSectionsCache } from "@/lib/client/episodeSectionsCache";

type SaveEpisodeLastPositionParams = {
  episodeId: string;
  videoId: string;
  seasonId: string;
  sectionIndex: number;
  partInSection: number;
};

function invalidateSectionsListCache(episodeId: string) {
  invalidateEpisodeSectionsCache(episodeId);
}

function lastPositionUrl(episodeId: string) {
  return `/api/episodes/${encodeURIComponent(episodeId)}/last-position`;
}

export function saveEpisodeLastPositionBeacon(
  params: SaveEpisodeLastPositionParams,
) {
  invalidateSectionsListCache(params.episodeId);
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  const blob = new Blob([JSON.stringify(params)], {
    type: "application/json",
  });
  navigator.sendBeacon(lastPositionUrl(params.episodeId), blob);
}

export async function saveEpisodeLastPosition(
  params: SaveEpisodeLastPositionParams,
) {
  invalidateSectionsListCache(params.episodeId);
  try {
    await fetch(lastPositionUrl(params.episodeId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      keepalive: true,
    });
  } catch {
    /* non-fatal */
  }
}
