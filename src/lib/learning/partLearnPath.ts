import type { VideoType } from "@/types/video";
import {
  partInSectionFromOrder,
  sectionIndexFromOrder,
} from "@/lib/learning/sections";

/** Narrow shape from Prisma selects for routing. */
export type PartRoutingShape = {
  order: number;
  videoId: string | null;
  episodeId: string | null;
  video:
    | {
        id: string;
        type: VideoType;
      }
    | null;
  episode:
    | {
        id: string;
        seasonId: string;
        season: { videoId: string };
      }
    | null;
};

export type LearnPathOptions = {
  /** 1-based step within the section (defaults from part global order). */
  step?: number;
  /** Spaced-repetition Review Time session. */
  review?: boolean;
  autoplay?: boolean;
};

/**
 * Absolute app path for the learn UI (no locale prefix — `Link` from `@/i18n/navigation` adds it).
 */
export function learnPathForPart(
  p: PartRoutingShape,
  opts?: LearnPathOptions,
): string | null {
  const s = sectionIndexFromOrder(p.order);
  const step = opts?.step ?? partInSectionFromOrder(p.order);
  const q = new URLSearchParams({ step: String(step) });
  if (opts?.review) {
    q.set("review", "1");
    if (opts.autoplay !== false) q.set("autoplay", "1");
  }
  const qp = `?${q.toString()}`;

  if (p.episode?.season && p.video?.type === "series") {
    const videoId = p.episode.season.videoId;
    const seasonId = p.episode.seasonId;
    const episodeId = p.episode.id;
    return `/learn/series/${videoId}/${seasonId}/${episodeId}/section/${s}${qp}`;
  }

  if (p.video?.id) {
    return `/learn/${p.video.type}/${p.video.id}/section/${s}${qp}`;
  }

  return null;
}

/** Review Time entry for a due reminder / saved part route. */
export function learnReviewPathForPart(p: PartRoutingShape): string | null {
  return learnPathForPart(p, { review: true, autoplay: true });
}
