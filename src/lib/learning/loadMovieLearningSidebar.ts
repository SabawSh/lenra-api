/**
 * Sidebar data for the movie Learning page — real saved cards + reminders.
 * Reminder items are hydrated as Clip-card peers (same part_id identity).
 */
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import {
  countSavedVocabularyCardsForUser,
  listRecentSavedWordsForEpisode,
  listRecentSavedWordsForVideo,
  listSavedCardIdByClipForUserParts,
} from "@/lib/db/queries/savedVocabularyCards";
import {
  listUserRemindersDueTodayForEpisodeJoined,
  listUserRemindersDueTodayJoined,
} from "@/lib/db/queries/userReminders";
import { listPartsByIds, fetchVideoScalarsById } from "@/lib/db/queries/videos";
import type { BatchCompletionSummary } from "@/lib/learning/batchCompletionSummary";
import {
  recentBatchFromCompletionSummary,
} from "@/lib/learning/batchCompletionSummary";
import type { LearningBatchMapItem } from "@/lib/learning/learningBatchUi";
import {
  displayBatchCompletedCount,
  resolveBatchCtaMode,
} from "@/lib/learning/learningBatchUi";
import { dedupeByPartId } from "@/lib/learning/batchClipDedupe";
import { learnReviewPathForPart } from "@/lib/learning/partLearnPath";
import {
  partInSectionFromOrder,
  sectionIndexFromOrder,
} from "@/lib/learning/sections";
import { buildPartRoutingShape } from "@/lib/learning/partRoutingShape";
import { resolvePublicMediaUrl } from "@/lib/media/resolvePublicMediaUrl";
import { isQualifiedComplete } from "@/lib/skill-engine/domain/progressAccessors";
import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";

export type MovieLearningSidebarReminder = {
  reminderId: number;
  partId: string;
  partOrder: number;
  sectionIndex: number;
  partInSection: number;
  /** English caption only — no Persian on reminder cards. */
  englishText: string;
  practiceHref: string | null;
  thumbnailUrl: string | null;
  hlsManifestUrl: string | null;
  videoUrl: string | null;
  coverFallbackUrl: string | null;
  saved: boolean;
  savedCardId: number | null;
  /** Always review for due-today reminders. */
  state: "review";
  completed: boolean;
};

export type MovieLearningSidebarSaved = {
  word: string;
  clipId: string;
};

export type MovieLearningSidebarRecentBatch = {
  /** Must match the currently selected batch — never a previous batch. */
  sectionIndex: number;
  completedCount: number;
  totalCount: number;
  sectionXp: number | null;
  /** Saved vocabulary cards for clips in this batch (not "new words"). */
  savedVocabCount: number | null;
  avgBestScore: number | null;
} | null;

export { recentBatchFromCompletionSummary };
export type MovieLearningSidebarData = {
  progress: {
    completedCount: number;
    totalCount: number;
    ctaMode: "start" | "continue" | "review";
    continueClipIndex: number;
    estimateMinutes: number;
  };
  saved: {
    totalCount: number;
    recentWords: MovieLearningSidebarSaved[];
  };
  reminders: {
    /** Due-today review cards for this title (reviewed items are omitted). */
    dueTodayCount: number;
    items: MovieLearningSidebarReminder[];
  };
  recentBatch: MovieLearningSidebarRecentBatch;
};

function rootVideoForReminder(r: {
  seasonVideoId: string | null;
  svType: VideoType | null;
}): { id: string; type: VideoType } | null {
  if (r.seasonVideoId && r.svType) return { id: r.seasonVideoId, type: r.svType };
  return null;
}

export function emptyMovieLearningSidebar(params?: {
  currentBatch?: LearningBatchMapItem | null;
  continueClipIndex?: number;
}): MovieLearningSidebarData {
  const batch = params?.currentBatch ?? null;
  const completedCount = batch ? displayBatchCompletedCount(batch) : 0;
  const totalCount = batch?.clipCount ?? 10;
  const continueClipIndex = params?.continueClipIndex ?? 1;
  const remaining = Math.max(0, totalCount - completedCount);
  return {
    progress: {
      completedCount,
      totalCount,
      ctaMode: batch ? resolveBatchCtaMode(batch) : "start",
      continueClipIndex,
      estimateMinutes: Math.max(1, remaining),
    },
    saved: { totalCount: 0, recentWords: [] },
    reminders: { dueTodayCount: 0, items: [] },
    recentBatch: null,
  };
}

export async function loadMovieLearningSidebar(params: {
  userId: UserId | null;
  videoId: string;
  episodeId?: string | null;
  currentBatch: LearningBatchMapItem | null;
  continueClipIndex: number;
  /** Only for the currently selected batch — drives recentBatch card. */
  completionSummary?: BatchCompletionSummary | null;
  /** Skip a second videos-row fetch when the page already loaded it. */
  coverUrl?: string | null;
}): Promise<MovieLearningSidebarData> {
  const batch = params.currentBatch;
  const completedCount = batch ? displayBatchCompletedCount(batch) : 0;
  const totalCount = batch?.clipCount ?? 10;
  const ctaMode = batch ? resolveBatchCtaMode(batch) : "start";
  const remaining = Math.max(0, totalCount - completedCount);

  const empty: MovieLearningSidebarData = {
    progress: {
      completedCount,
      totalCount,
      ctaMode,
      continueClipIndex: params.continueClipIndex,
      estimateMinutes: Math.max(1, remaining),
    },
    saved: { totalCount: 0, recentWords: [] },
    reminders: { dueTodayCount: 0, items: [] },
    // Scoped strictly to the selected batch's completion summary.
    recentBatch: recentBatchFromCompletionSummary(params.completionSummary),
  };

  if (!params.userId) return empty;

  const [savedTotal, recentWords, dueJoined, video] = await Promise.all([
    countSavedVocabularyCardsForUser(params.userId),
    params.episodeId
      ? listRecentSavedWordsForEpisode(params.userId, params.episodeId, 6)
      : listRecentSavedWordsForVideo(params.userId, params.videoId, 6),
    params.episodeId
      ? listUserRemindersDueTodayForEpisodeJoined(
          params.userId,
          params.episodeId,
        )
      : listUserRemindersDueTodayJoined(params.userId, 32),
    params.coverUrl !== undefined
      ? Promise.resolve(null)
      : fetchVideoScalarsById(params.videoId),
  ]);

  const rawCover =
    params.coverUrl !== undefined ? params.coverUrl : video?.coverUrl ?? null;
  const coverFallbackUrl = rawCover ? resolvePublicMediaUrl(rawCover) : null;

  const reminderSource = params.episodeId
    ? dueJoined
    : dueJoined.filter((r) => r.seasonVideoId === params.videoId);

  const uniqueReminderRows = dedupeByPartId(
    reminderSource.map((r) => ({ ...r, partId: r.partId })),
  );

  const reminderPartIds = uniqueReminderRows.map((r) => r.partId);
  const [parts, savedByClip, progressSlices] = await Promise.all([
    reminderPartIds.length > 0
      ? listPartsByIds(reminderPartIds)
      : Promise.resolve([]),
    reminderPartIds.length > 0
      ? listSavedCardIdByClipForUserParts(params.userId, reminderPartIds)
      : Promise.resolve(new Map<string, number>()),
    reminderPartIds.length > 0
      ? listProgressSliceForParts(params.userId, reminderPartIds)
      : Promise.resolve([]),
  ]);

  const partById = new Map(parts.map((p) => [p.id, p]));
  const progressById = new Map(
    progressSlices.map((s) => [
      s.partId,
      {
        bestScore: s.bestScore,
        completedAt: s.completedAt,
        attempts: s.attempts,
        wrongMoves: s.wrongMoves,
      },
    ]),
  );

  const items: MovieLearningSidebarReminder[] = uniqueReminderRows.map((r) => {
    const part = partById.get(r.partId);
    const cap = (part?.text ?? r.text)?.trim() ?? "";
    const englishText =
      cap.length <= 140 ? cap || `Clip` : `${cap.slice(0, 137)}…`;
    const root = rootVideoForReminder(r);
    const practiceHref =
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
    const thumbRaw = part?.thumbnailUrl?.trim() || null;
    const savedCardId = savedByClip.get(r.partId) ?? null;
    const progress = progressById.get(r.partId) ?? null;

    return {
      reminderId: r.id,
      partId: r.partId,
      partOrder: r.partOrder,
      sectionIndex: sectionIndexFromOrder(r.partOrder),
      partInSection: partInSectionFromOrder(r.partOrder),
      englishText,
      practiceHref,
      thumbnailUrl: thumbRaw ? resolvePublicMediaUrl(thumbRaw) : null,
      hlsManifestUrl: part?.hlsManifestUrl?.trim() || null,
      videoUrl: part?.videoUrl?.trim() || null,
      coverFallbackUrl,
      saved: savedCardId != null,
      savedCardId,
      state: "review" as const,
      completed: isQualifiedComplete(progress),
    };
  });

  const seen = new Set<string>();
  const uniqueWords: MovieLearningSidebarSaved[] = [];
  for (const w of recentWords) {
    const key = w.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueWords.push(w);
    if (uniqueWords.length >= 5) break;
  }

  return {
    ...empty,
    saved: {
      totalCount: savedTotal,
      recentWords: uniqueWords,
    },
    reminders: {
      dueTodayCount: items.length,
      items,
    },
  };
}
