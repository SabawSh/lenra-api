import { listCompletedPartIdsAmong } from "@/lib/db/queries/userPartProgress";
import * as vq from "@/lib/db/queries/videos";

import type { UserId } from "@/types/schema";
/** Completed-part ratio for a movie/documentary or a single series episode. */
export async function computeScopeProgress(
  userId: UserId,
  scope: { videoId: string } | { episodeId: string },
  currentOrder: number,
): Promise<{ progressPct: number; minutesLeft: number | null }> {
  const { dashTime } = await import("@/lib/debug/dashboardTiming");
  const parts = await dashTime("SQL listPartIdOrderDuration", () =>
    vq.listPartIdOrderDuration(
      "episodeId" in scope
        ? { episodeId: scope.episodeId }
        : { videoId: scope.videoId },
    ),
  );

  if (parts.length === 0) {
    return { progressPct: 0, minutesLeft: null };
  }

  const completedIds = new Set(
    await dashTime("SQL listCompletedPartIdsAmong", () =>
      listCompletedPartIdsAmong(
        userId,
        parts.map((p) => p.id),
      ),
    ),
  );
  const completedCount = parts.filter((p) => completedIds.has(p.id)).length;
  const progressPct = Math.min(
    100,
    Math.round((completedCount / parts.length) * 100),
  );

  let remainingMs = 0;
  for (const p of parts) {
    if (p.order >= currentOrder && !completedIds.has(p.id)) {
      remainingMs += p.playbackDurationMs;
    }
  }

  const minutesLeft =
    remainingMs > 0 ? Math.max(1, Math.ceil(remainingMs / 60000)) : null;

  return { progressPct, minutesLeft };
}
