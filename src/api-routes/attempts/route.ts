import {
  analyticsContextFromRequest,
  emitServerAnalyticsEvent,
} from "@/lib/analytics/serverEmit";
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { getDbPool, withTransaction } from "@/lib/db/connection";
import { incrementUserDailyLearningTimeMs } from "@/lib/db/queries/progress";
import { incrementUserTotalLearningTimeMs } from "@/lib/db/queries/users";
import { localDateKey, recordLearningActivityDay } from "@/lib/db/learningStreak";
import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;
  try {
    const body = (await req.json()) as { learningTimeMs?: any };
    const learningTimeMs: any = body.learningTimeMs;
    const parsedLearningTimeMs = Number(learningTimeMs);

    if (!Number.isFinite(parsedLearningTimeMs) || parsedLearningTimeMs <= 0) {
      return NextResponse.json(
        { error: "Invalid learningTimeMs value" },
        { status: 400 },
      );
    }

    const delta = Math.round(parsedLearningTimeMs);
    const dayKey = localDateKey();

    await withTransaction(async (conn) => {
      await incrementUserTotalLearningTimeMs(user.id, delta, conn);
      await incrementUserDailyLearningTimeMs(conn, user.id, dayKey, delta);
    });

    await recordLearningActivityDay(user.id);

    // daily_goal_completed when crossing the user's goal threshold (idempotent per day).
    try {
      const pool = getDbPool();
      const [[goalRow]] = await pool.query<(RowDataPacket & { daily_goal_minutes: number | null; learning_time_ms: number | null })[]>(
        `SELECT u.daily_goal_minutes,
                (SELECT learning_time_ms FROM user_daily_learning_time
                 WHERE user_id = u.id AND day_key = ? LIMIT 1) AS learning_time_ms
         FROM users u WHERE u.id = ? LIMIT 1`,
        [dayKey, user.id],
      );
      const goalMin = Number(goalRow?.daily_goal_minutes ?? 0);
      const learnedMs = Number(goalRow?.learning_time_ms ?? 0);
      if (goalMin > 0 && learnedMs >= goalMin * 60_000) {
        await emitServerAnalyticsEvent({
          userId: user.id,
          name: "daily_goal_completed",
          properties: { duration_ms: learnedMs, success: true },
          context: analyticsContextFromRequest(req),
          idempotencyKey: `daily_goal_${user.id}_${dayKey}`,
        });
      }
    } catch (err) {
      console.warn("[attempts] daily_goal analytics", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating learning time:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
