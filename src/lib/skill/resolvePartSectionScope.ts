import {
  countPartsForEpisodeId,
  countPartsForVideoId,
  isStandaloneVideoType,
} from "@/lib/db/queries/videos";
import { findUserEnglishLevelById } from "@/lib/db/queries/users";
import { pool } from "@/lib/db/connection";
import type { AdaptiveOrderUser } from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  resolveVisibleSectionIndexForPart,
  type SectionCurriculumScope,
} from "@/lib/learning/sectionCurriculum";
import { sectionIndexFromOrder } from "@/lib/learning/sections";
import type { Part } from "@/types/video";
import type { UserId } from "@/types/schema";
import type { RowDataPacket } from "mysql2/promise";
import type { VideoType } from "@/types/video";

export type SectionAdaptiveScope =
  | { kind: "episode"; episodeId: string }
  | { kind: "video"; videoId: string };

export type PartSectionAdaptiveContext = {
  sectionIndex: number;
  totalParts: number;
  /** Stable key for idempotency + logging. */
  sectionKey: string;
  sectionId: string;
  scope: SectionAdaptiveScope;
};

type PartScopeRow = RowDataPacket & {
  part_order: number;
  episode_id: string;
  video_id: string;
  video_type: VideoType;
};

async function resolveAdaptiveOrderUser(
  userId: UserId,
): Promise<AdaptiveOrderUser> {
  const englishLevel = await findUserEnglishLevelById(userId);
  return { id: userId, englishLevel };
}

async function resolveVisibleSectionIndex(
  partId: string,
  scope: SectionCurriculumScope,
  totalParts: number,
  userId: UserId,
): Promise<number | null> {
  const user = await resolveAdaptiveOrderUser(userId);
  return resolveVisibleSectionIndexForPart(scope, partId, user, totalParts);
}

export async function fetchPartAdaptiveSectionContext(
  part: Part,
  userId?: UserId,
): Promise<PartSectionAdaptiveContext | null> {
  const [rows] = await pool.execute<PartScopeRow[]>(
    `
    SELECT
      p.\`order\` AS part_order,
      CAST(p.episode_id AS CHAR) AS episode_id,
      CAST(s.video_id AS CHAR) AS video_id,
      v.type AS video_type
    FROM parts p
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    INNER JOIN videos v ON v.id = s.video_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [part.id],
  );
  const row = rows[0];
  if (!row) return null;

  const order = Number(row.part_order);
  let sectionIndex = sectionIndexFromOrder(order);

  if (isStandaloneVideoType(row.video_type)) {
    const videoId = String(row.video_id);
    const totalParts = await countPartsForVideoId(videoId);
    if (totalParts < 1) return null;

    if (userId) {
      const visibleIndex = await resolveVisibleSectionIndex(
        part.id,
        { videoId, curriculumId: `video:${videoId}` },
        totalParts,
        userId,
      );
      if (visibleIndex != null) sectionIndex = visibleIndex;
    }

    return {
      sectionIndex,
      totalParts,
      sectionKey: `video:${videoId}:s${sectionIndex}`,
      sectionId: `video:${videoId}:section:${sectionIndex}`,
      scope: { kind: "video", videoId },
    };
  }

  const episodeId = String(row.episode_id);
  const totalParts = await countPartsForEpisodeId(episodeId);
  if (totalParts < 1) return null;

  if (userId) {
    const visibleIndex = await resolveVisibleSectionIndex(
      part.id,
      { episodeId, curriculumId: `episode:${episodeId}` },
      totalParts,
      userId,
    );
    if (visibleIndex != null) sectionIndex = visibleIndex;
  }

  return {
    sectionIndex,
    totalParts,
    sectionKey: `episode:${episodeId}:s${sectionIndex}`,
    sectionId: `episode:${episodeId}:section:${sectionIndex}`,
    scope: { kind: "episode", episodeId },
  };
}

export function sectionScopeParams(ctx: PartSectionAdaptiveContext): {
  sectionIndex: number;
  totalParts: number;
  episodeId?: string;
  videoId?: string;
} {
  return {
    sectionIndex: ctx.sectionIndex,
    totalParts: ctx.totalParts,
    ...(ctx.scope.kind === "episode"
      ? { episodeId: ctx.scope.episodeId }
      : { videoId: ctx.scope.videoId }),
  };
}
