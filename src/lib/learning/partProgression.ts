import type { VideoType } from "@/types/video";

/** Catalog + optional progress fields for sequential resume. */
export type PartCatalogAnchor = {
  partId: string;
  order: number;
  episodeId: string;
  seasonId: string;
  videoId: string;
  videoType: VideoType;
  videoName: string;
  seasonNum: number;
  episodeNum: number;
  episodeTitle: string | null;
  completedAt: Date | null;
  bestScore: number;
  lastAttemptAt: Date | null;
};

export type PartCatalogAnchorBare = Omit<
  PartCatalogAnchor,
  "completedAt" | "bestScore" | "lastAttemptAt"
>;

/** Part is finished when marked complete (score > 0 path in performance API). */
export function isPartProgressComplete(anchor: {
  completedAt: Date | null;
}): boolean {
  return anchor.completedAt != null;
}

/**
 * If the anchor part is complete, resume the next sequential part when it exists;
 * otherwise stay on the anchor (in-progress or replay at end of title).
 */
export function pickResumeOrNextSequential(
  current: PartCatalogAnchor,
  next: PartCatalogAnchorBare | null,
): PartCatalogAnchorBare {
  if (!isPartProgressComplete(current)) {
    return stripProgressFields(current);
  }
  return next ?? stripProgressFields(current);
}

function stripProgressFields(anchor: PartCatalogAnchor): PartCatalogAnchorBare {
  const {
    completedAt: _c,
    bestScore: _b,
    lastAttemptAt: _l,
    ...bare
  } = anchor;
  return bare;
}
