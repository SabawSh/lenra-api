/**
 * Dashboard Reminders page loader — calendar + title filters over user_reminders.
 */
import {
  listUserReminderDayCounts,
  listUserRemindersForDayJoined,
  listUserReminderTitles,
} from "@/lib/db/queries/userReminders";
import { dedupeByPartId } from "@/lib/learning/batchClipDedupe";
import { learnReviewPathForPart } from "@/lib/learning/partLearnPath";
import { buildPartRoutingShape } from "@/lib/learning/partRoutingShape";
import {
  buildMonthGrid,
  calendarKindForLocale,
  type CalendarKind,
} from "@/lib/learning/persianCalendar";
import {
  dayBoundsFromIsoDate,
  parseRemindersPageFilters,
  type RemindersPageFilters,
} from "@/lib/learning/remindersPageFilters";
import type { UserId } from "@/types/schema";
import type { VideoType } from "@/types/video";

export type RemindersPageCard = {
  reminderId: number;
  partId: string;
  englishText: string;
  dueAtIso: string;
  practiceHref: string | null;
  videoId: string;
  videoName: string;
  videoType: VideoType;
};

export type RemindersPageTitleOption = {
  videoId: string;
  videoName: string;
  videoType: VideoType;
  count: number;
};

export type RemindersPageData = {
  filters: RemindersPageFilters;
  isGuest: boolean;
  cards: RemindersPageCard[];
  titles: RemindersPageTitleOption[];
  /** day ISO → count for the visible calendar month */
  dayCounts: Record<string, number>;
  calendarKind: CalendarKind;
};

export async function loadRemindersPage(params: {
  userId: UserId | null;
  searchParams: { date?: string; titleId?: string };
  locale: string;
  now?: Date;
}): Promise<RemindersPageData> {
  const now = params.now ?? new Date();
  const filters = parseRemindersPageFilters(params.searchParams, now);
  const calendarKind = calendarKindForLocale(params.locale);
  const grid = buildMonthGrid({
    kind: calendarKind,
    focusIso: filters.date,
  });

  const empty: RemindersPageData = {
    filters,
    isGuest: !params.userId,
    cards: [],
    titles: [],
    dayCounts: {},
    calendarKind,
  };

  if (!params.userId) return empty;

  const { start: dayStart, end: dayEnd } = dayBoundsFromIsoDate(filters.date);

  const [rows, titles, dayCountRows] = await Promise.all([
    listUserRemindersForDayJoined({
      userId: params.userId,
      dayStart,
      dayEnd,
      rootVideoId: filters.titleId,
      limit: 120,
    }),
    listUserReminderTitles(params.userId),
    listUserReminderDayCounts({
      userId: params.userId,
      rangeStart: grid.rangeStart,
      rangeEnd: grid.rangeEnd,
      rootVideoId: filters.titleId,
    }),
  ]);

  const unique = dedupeByPartId(rows.map((r) => ({ ...r, partId: r.partId })));

  const cards: RemindersPageCard[] = unique.map((r) => {
    const cap = r.text?.trim() ?? "";
    const englishText =
      cap.length <= 160 ? cap || `Clip ${r.partOrder}` : `${cap.slice(0, 157)}…`;
    const videoId = r.seasonVideoId ?? "";
    const videoType = r.videoType;
    const practiceHref =
      videoId && r.svType
        ? learnReviewPathForPart(
            buildPartRoutingShape({
              order: r.partOrder,
              partEpisodeId: r.partEpisodeId,
              seasonId: r.seasonId,
              seasonVideoId: r.seasonVideoId,
              rootVideoId: videoId,
              rootVideoType: videoType,
            }),
          )
        : null;

    return {
      reminderId: r.id,
      partId: r.partId,
      englishText,
      dueAtIso: r.dueAt.toISOString(),
      practiceHref,
      videoId,
      videoName: r.videoName,
      videoType,
    };
  });

  const dayCounts: Record<string, number> = {};
  for (const row of dayCountRows) {
    dayCounts[row.date] = row.count;
  }

  return {
    filters,
    isGuest: false,
    cards,
    titles,
    dayCounts,
    calendarKind,
  };
}
