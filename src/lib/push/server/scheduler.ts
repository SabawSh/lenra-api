
import {
  listUsersForReviewReminderPush,
  listUsersForStreakReminderPush,
} from "@/lib/db/queries/pushReminders";
import { tryLogNotificationSent, pruneOldNotificationLogs } from "@/lib/db/pushNotificationLog";
import { isWebPushConfigured } from "./vapid";
import {
  buildReviewDigestPayload,
  buildStreakNudgePayload,
  reviewDigestNotificationKey,
  streakNotificationKey,
} from "./digest";
import { pushLog } from "./logger";
import { sendPushToUser } from "./sendToUser";

export type SchedulerRunResult = {
  reviewUsers: number;
  reviewSent: number;
  streakUsers: number;
  streakSent: number;
  prunedLogs: number;
};

export async function runPushReminderScheduler(): Promise<SchedulerRunResult> {
  if (!isWebPushConfigured()) {
    pushLog.warn("scheduler skipped — VAPID not configured");
    return {
      reviewUsers: 0,
      reviewSent: 0,
      streakUsers: 0,
      streakSent: 0,
      prunedLogs: 0,
    };
  }

  const reviewCandidates = await listUsersForReviewReminderPush();
  let reviewSent = 0;

  for (const candidate of reviewCandidates) {
    const key = reviewDigestNotificationKey(candidate.userId);
    const acquired = await tryLogNotificationSent(candidate.userId, key);
    if (!acquired) continue;

    const payload = buildReviewDigestPayload(candidate);
    const result = await sendPushToUser(candidate.userId, payload);
    if (result.sent > 0) reviewSent += 1;
  }

  const streakCandidates = await listUsersForStreakReminderPush();
  let streakSent = 0;

  for (const candidate of streakCandidates) {
    const key = streakNotificationKey(candidate.userId);
    const acquired = await tryLogNotificationSent(candidate.userId, key);
    if (!acquired) continue;

    const payload = buildStreakNudgePayload(candidate.streakCurrent);
    const result = await sendPushToUser(candidate.userId, payload);
    if (result.sent > 0) streakSent += 1;
  }

  const prunedLogs = await pruneOldNotificationLogs();

  pushLog.info("scheduler completed", {
    reviewUsers: reviewCandidates.length,
    reviewSent,
    streakUsers: streakCandidates.length,
    streakSent,
    prunedLogs,
  });

  return {
    reviewUsers: reviewCandidates.length,
    reviewSent,
    streakUsers: streakCandidates.length,
    streakSent,
    prunedLogs,
  };
}
