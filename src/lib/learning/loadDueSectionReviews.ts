import {
  listUserRemindersDueTodayForEpisodeJoined,
  listUserRemindersDueTodayJoined,
} from "@/lib/db/queries/userReminders";
import type { SectionDisplayReviewRef } from "@/lib/learning/sectionDisplayComposition";
import type { UserId } from "@/types/schema";

/** Due Review Time queue for a title (user_reminders due today). */
export async function getDueReviews(params: {
  userId: UserId;
  videoId: string;
  episodeId?: string | null;
  now?: Date;
}): Promise<SectionDisplayReviewRef[]> {
  void params.now;
  return loadDueSectionReviewsForVideo(params);
}

/** Due-today reminders for a movie/standalone video scope, stable order. */
export async function loadDueSectionReviewsForVideo(params: {
  userId: UserId;
  videoId: string;
  episodeId?: string | null;
}): Promise<SectionDisplayReviewRef[]> {
  if (params.episodeId) {
    const rows = await listUserRemindersDueTodayForEpisodeJoined(
      params.userId,
      params.episodeId,
    );
    return rows.map((r) => ({ partId: r.partId, reminderId: r.id }));
  }
  const rows = await listUserRemindersDueTodayJoined(params.userId, 200);
  return rows
    .filter((r) => r.seasonVideoId === params.videoId)
    .map((r) => ({ partId: r.partId, reminderId: r.id }));
}
