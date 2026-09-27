import {
  fetchFirstIncompletePartAnchorForUserVideo,
  fetchFirstPartAnchorForVideo,
  fetchLatestCompletedPartAnchorForUserVideo,
  fetchLatestPartProgressAnchorForEpisode,
  fetchLatestPartProgressAnchorForUser,
  fetchLatestPartProgressAnchorForVideo,
  fetchNextSequentialPartAfter,
  fetchNextSequentialPartInEpisodeAfter,
  fetchPartCatalogAnchorByPartId,
} from "@/lib/db/queries/partProgression";
import { buildPartRoutingShape } from "@/lib/learning/partRoutingShape";
import {
  pickResumeOrNextSequential,
  type PartCatalogAnchor,
  type PartCatalogAnchorBare,
} from "@/lib/learning/partProgression";
import { learnPathForPart } from "@/lib/learning/partLearnPath";
import {
  partInSectionFromOrder,
  sectionIndexFromOrder,
} from "@/lib/learning/sections";
import type { UserId } from "@/types/schema";
import type { UserLastPosition } from "@/lib/learning/sectionResume";

export type CanonicalResumeTarget = PartCatalogAnchorBare & {
  learnHref: string | null;
  sectionIndex: number;
  partInSection: number;
};

function routingForAnchor(anchor: PartCatalogAnchorBare) {
  return buildPartRoutingShape({
    order: anchor.order,
    partEpisodeId: anchor.episodeId,
    seasonId: anchor.seasonId,
    seasonVideoId: anchor.videoId,
    rootVideoId: anchor.videoId,
    rootVideoType: anchor.videoType,
  });
}

function toResumeTarget(anchor: PartCatalogAnchorBare): CanonicalResumeTarget {
  const routing = routingForAnchor(anchor);
  return {
    ...anchor,
    learnHref: learnPathForPart(routing),
    sectionIndex: sectionIndexFromOrder(anchor.order),
    partInSection: partInSectionFromOrder(anchor.order),
  };
}

async function resolveFromAnchor(
  anchor: PartCatalogAnchor,
  nextInEpisodeOnly: boolean,
): Promise<CanonicalResumeTarget> {
  const next = nextInEpisodeOnly
    ? await fetchNextSequentialPartInEpisodeAfter(
        anchor.episodeId,
        anchor.order,
      )
    : await fetchNextSequentialPartAfter(anchor);
  const picked = pickResumeOrNextSequential(anchor, next);
  return toResumeTarget(picked);
}

/** Global resume: latest progress, advancing when that part is complete. */
export async function getCanonicalResumePart(
  userId: UserId,
): Promise<CanonicalResumeTarget | null> {
  const anchor = await fetchLatestPartProgressAnchorForUser(userId);
  if (!anchor) return null;
  return resolveFromAnchor(anchor, false);
}

export async function getCanonicalResumePartForVideo(
  userId: UserId,
  videoId: string,
): Promise<CanonicalResumeTarget | null> {
  const anchor = await fetchLatestPartProgressAnchorForVideo(userId, videoId);
  if (!anchor) return null;
  return resolveFromAnchor(anchor, false);
}

/**
 * Dashboard continue card: next part after the furthest completed clip in catalog order.
 * Falls back to the first incomplete part when nothing is finished yet.
 */
export async function getContinueLearningPartForVideo(
  userId: UserId,
  videoId: string,
): Promise<CanonicalResumeTarget | null> {
  const lastCompleted = await fetchLatestCompletedPartAnchorForUserVideo(
    userId,
    videoId,
  );
  if (lastCompleted) {
    const next = await fetchNextSequentialPartAfter(lastCompleted);
    return toResumeTarget(next ?? lastCompleted);
  }

  const incomplete = await fetchFirstIncompletePartAnchorForUserVideo(
    userId,
    videoId,
  );
  if (incomplete) return toResumeTarget(incomplete);

  const first = await fetchFirstPartAnchorForVideo(videoId);
  return first ? toResumeTarget(first) : null;
}

export async function getCanonicalResumePartForEpisode(
  userId: UserId,
  episodeId: string,
): Promise<CanonicalResumeTarget | null> {
  const anchor = await fetchLatestPartProgressAnchorForEpisode(
    userId,
    episodeId,
  );
  if (!anchor) return null;
  return resolveFromAnchor(anchor, true);
}

export { fetchNextSequentialPartAfter as getNextSequentialPart } from "@/lib/db/queries/partProgression";

export async function resolveNextPartForUser(
  userId: UserId,
  fromPartId: string,
): Promise<CanonicalResumeTarget | null> {
  const bare = await fetchPartCatalogAnchorByPartId(fromPartId);
  if (!bare) return null;

  const anchor: PartCatalogAnchor = {
    ...bare,
    completedAt: new Date(),
    bestScore: 1,
    lastAttemptAt: new Date(),
  };
  return resolveFromAnchor(anchor, false);
}

export async function getUserLastPositionFromProgress(
  userId: UserId,
  scope: { videoId: string } | { episodeId: string },
): Promise<UserLastPosition | null> {
  const target =
    "episodeId" in scope
      ? await getCanonicalResumePartForEpisode(userId, scope.episodeId)
      : await getCanonicalResumePartForVideo(userId, scope.videoId);
  if (!target) return null;

  // Canonical order→section is only a hint. Resume surfaces clamp via
  // resolveBookmarkResumePlacement (cheap unlock frontier) — do not rebuild
  // the full adaptive catalog here (that blocked the dashboard for 20s+).
  return {
    sectionIndex: target.sectionIndex,
    visibleUnitStep: target.partInSection,
  };
}
