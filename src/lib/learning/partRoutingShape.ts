import type { PartRoutingShape } from "@/lib/learning/partLearnPath";
import type { VideoType } from "@/types/video";

/** Builds the narrow shape consumed by `learnPathForPart` from joined `parts` + video/episode rows. */
export function buildPartRoutingShape(params: {
  order: number;
  partEpisodeId: string | null;
  seasonId: string | null;
  seasonVideoId: string | null;
  rootVideoId: string;
  rootVideoType: VideoType;
}): PartRoutingShape {
  const hasEpisode =
    !!params.partEpisodeId &&
    params.seasonId != null &&
    params.seasonVideoId != null;
  return {
    order: params.order,
    videoId: null,
    episodeId: params.partEpisodeId,
    episode: hasEpisode
      ? {
          id: params.partEpisodeId!,
          seasonId: params.seasonId!,
          season: { videoId: params.seasonVideoId! },
        }
      : null,
    video: { id: params.rootVideoId, type: params.rootVideoType },
  };
}
