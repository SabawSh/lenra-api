import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { withTransaction } from "@/lib/db/connection";
import { incrementUserDailyLearningTimeMs } from "@/lib/db/queries/progress";
import { incrementUserTotalLearningTimeMs } from "@/lib/db/queries/users";
import { localDateKey, recordLearningActivityDay } from "@/lib/db/learningStreak";
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
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating learning time:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
