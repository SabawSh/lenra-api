"use server";

import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { saveUserVideoLastSeen } from "@/lib/db/lastSeen";

type RecordLastSeenParams = {
  videoId: string;
  order: number;
  seasonId?: string;
  episodeId?: string;
};

/** Server action: optional last-seen bookmark (not progression source of truth). */
export async function recordLastSeen(params: RecordLastSeenParams) {
  const user = await getCurrentUser();
  if (!user) return;
  await saveUserVideoLastSeen({ ...params, userId: user.id });
}
