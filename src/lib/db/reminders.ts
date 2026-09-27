import type { UserId } from "@/types/schema";
import {
  countAllUserReminders,
  countUserRemindersDueToday,
  listUserRemindersDueTodayForEpisodeJoined,
} from "@/lib/db/queries/userReminders";

export type DueReminderCardRow = {
  reminderId: number;
  partId: string;
  order: number;
  captionPreview: string;
  dueAtIso: string;
};

export async function countRemindersDueToday(userId: UserId): Promise<number> {
  return countUserRemindersDueToday(userId);
}

export async function countUserReminders(userId: UserId): Promise<number> {
  return countAllUserReminders(userId);
}

export async function getRemindersDueTodayForEpisode(
  userId: UserId,
  episodeId: string,
): Promise<DueReminderCardRow[]> {
  const rows = await listUserRemindersDueTodayForEpisodeJoined(
    userId,
    episodeId,
  );

  return rows.map((r) => {
    const cap = r.text?.trim() ?? "";
    const captionPreview =
      cap.length <= 140 ? cap || `Part ${r.partOrder}` : `${cap.slice(0, 137)}…`;
    return {
      reminderId: r.id,
      partId: r.partId,
      order: r.partOrder,
      captionPreview,
      dueAtIso: r.dueAt.toISOString(),
    };
  });
}
