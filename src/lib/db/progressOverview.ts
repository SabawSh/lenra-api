import { localDateKey } from "@/lib/db/learningStreak";
import { fetchDailyLearningMsForDayKey } from "@/lib/db/queries/dailyUserStats";
import {
  fetchLatestPartProgressAnchorForEpisode,
  fetchNextSequentialPartAfter,
  listRecentHistoryProgressAnchors,
} from "@/lib/db/queries/partProgression";
import { avgDurationSecPositiveForUser } from "@/lib/db/queries/userPartProgress";
import { listUserRemindersDueTodayJoined } from "@/lib/db/queries/userReminders";
import {
  listWeakTokenMarksWithPartJoin,
  type WeakMarkRowRaw,
} from "@/lib/db/queries/userTokenMarks";
import {
  learnPathForPart,
  learnReviewPathForPart,
} from "@/lib/learning/partLearnPath";
import { pickResumeOrNextSequential } from "@/lib/learning/partProgression";
import { buildPartRoutingShape } from "@/lib/learning/partRoutingShape";
import { visibleStepFromBookmarkOrder } from "@/lib/learning/sectionResume";
import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";

export type WeakSentenceCard = {
  partId: string;
  sentence: string;
  markType: "unknown" | "confused";
  practiceHref: string | null;
};

export type DueReviewRow = {
  reminderId: number;
  partId: string;
  sentencePreview: string;
  practiceHref: string | null;
};

export type HistoryRow = {
  videoId: string;
  title: string;
  contentType: VideoType;
  updatedAtIso: string;
  continueHref: string;
};

function rootVideoForLearnJoin(r: {
  seasonVideoId: string | null;
  svType: VideoType | null;
}): { id: string; type: VideoType } | null {
  if (r.seasonVideoId && r.svType)
    return { id: r.seasonVideoId, type: r.svType };
  return null;
}

function routingFromWeakMarkRow(
  row: WeakMarkRowRaw,
): ReturnType<typeof buildPartRoutingShape> | null {
  const root = rootVideoForLearnJoin(row);
  if (!root) return null;
  return buildPartRoutingShape({
    order: row.partOrder,
    partEpisodeId: row.partEpisodeId,
    seasonId: row.seasonId,
    seasonVideoId: row.seasonVideoId,
    rootVideoId: root.id,
    rootVideoType: root.type,
  });
}

function rankWeakType(t: string): number {
  if (t === "unknown") return 2;
  if (t === "confused") return 1;
  return 0;
}

/**
 * Sentence-first struggle cards — deduped per part (Unknown beats Confused; newest tie-break).
 */
export async function getWeakSentenceCardsForUser(
  userId: UserId,
  limit = 24,
): Promise<WeakSentenceCard[]> {
  const marks = await listWeakTokenMarksWithPartJoin(userId, 120);

  type MarkRow = WeakMarkRowRaw;
  const best = new Map<string, MarkRow>();

  for (const row of marks) {
    if (row.type !== "unknown" && row.type !== "confused") continue;
    const cur = best.get(row.partId);
    if (!cur) {
      best.set(row.partId, row);
      continue;
    }
    const newR = rankWeakType(row.type);
    const oldR = rankWeakType(cur.type);
    if (newR > oldR) best.set(row.partId, row);
  }

  const deduped = Array.from(best.values()).slice(0, limit);

  return deduped.map((row) => {
    const cap = row.text?.trim();
    const sentence = cap && cap.length > 0 ? cap : `#${row.partOrder}`;
    const routing = routingFromWeakMarkRow(row);
    const href = routing ? learnPathForPart(routing) : null;
    return {
      partId: row.partId,
      sentence,
      markType: row.type as "unknown" | "confused",
      practiceHref: href,
    };
  });
}

export async function getDueReviewRowsForUser(
  userId: UserId,
  limit = 40,
): Promise<DueReviewRow[]> {
  const rows = await listUserRemindersDueTodayJoined(userId, limit);

  return rows.map((r) => {
    const cap = r.text?.trim() ?? "";
    const sentencePreview =
      cap.length <= 160
        ? cap || `Part ${r.partOrder}`
        : `${cap.slice(0, 157)}…`;
    const root = rootVideoForLearnJoin(r);
    const href =
      root != null
        ? learnReviewPathForPart(
            buildPartRoutingShape({
              order: r.partOrder,
              partEpisodeId: r.partEpisodeId,
              seasonId: r.seasonId,
              seasonVideoId: r.seasonVideoId,
              rootVideoId: root.id,
              rootVideoType: root.type,
            }),
          )
        : null;
    return {
      reminderId: r.id,
      partId: r.partId,
      sentencePreview,
      practiceHref: href,
    };
  });
}

export async function getTodayLearningMinutes(userId: UserId): Promise<number> {
  const key = localDateKey();
  const ms = await fetchDailyLearningMsForDayKey(userId, key);
  return Math.round((ms / 60000) * 10) / 10;
}

export async function getAvgResponseSec(
  userId: UserId,
): Promise<number | null> {
  const v = await avgDurationSecPositiveForUser(userId);
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(v * 10) / 10;
}

export function buildHistoryContinueHref(entry: {
  videoId: string;
  order: number;
  type: VideoType;
  seasonId: string;
  episodeId: string;
}): string {
  const { sectionIndex: s, visibleUnitStep: step } =
    visibleStepFromBookmarkOrder(entry.order);
  if (entry.type === "series") {
    return `/learn/series/${entry.videoId}/${entry.seasonId}/${entry.episodeId}/section/${s}?step=${step}`;
  }
  return `/learn/${entry.type}/${entry.videoId}/section/${s}?step=${step}`;
}

async function canonicalOrderForHistoryRow(
  userId: UserId,
  row: {
    videoId: string;
    order: number;
    videoType: VideoType;
    seasonId: string;
    episodeId: string;
  },
): Promise<number> {
  const latest = await fetchLatestPartProgressAnchorForEpisode(
    userId,
    row.episodeId,
  );
  if (!latest) return row.order;

  const next = await fetchNextSequentialPartAfter(latest);
  const picked = pickResumeOrNextSequential(latest, next);
  return picked.order;
}

export async function getHistoryContinueRows(
  userId: UserId,
  limit = 12,
): Promise<HistoryRow[]> {
  const rows = await listRecentHistoryProgressAnchors(userId, limit);

  const out: HistoryRow[] = [];
  for (const r of rows) {
    const order = await canonicalOrderForHistoryRow(userId, r);
    out.push({
      videoId: r.videoId,
      title: r.videoName,
      contentType: r.videoType,
      updatedAtIso: r.updatedAt.toISOString(),
      continueHref: buildHistoryContinueHref({
        videoId: r.videoId,
        order,
        type: r.videoType,
        seasonId: r.seasonId,
        episodeId: r.episodeId,
      }),
    });
  }

  return out;
}
