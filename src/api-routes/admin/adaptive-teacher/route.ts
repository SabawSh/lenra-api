import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import {
  countAdaptiveTeacherEventsForUser,
  listAdaptiveTeacherEventsForUser,
} from "@/lib/db/queries/adaptiveTeacherEvents";
import { findUserOverallSkill } from "@/lib/db/queries/userAdaptiveSkill";
import { countQualifiedCompletedPartsForUser } from "@/lib/db/queries/userPartProgress";
import { getUserById, listUsersForAdmin } from "@/lib/db/queries/users";
import { getStreakForUser } from "@/lib/db/learningStreak";
import { skillToDisplayLevel } from "@/lib/skill/adaptiveTeacherDecision";
import { isUserId } from "@/lib/db/userId";
import type { UserId } from "@/types/schema";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, user };
}

/**
 * GET /api/admin/adaptive-teacher
 * List recent users (optional ?q= to filter by id, email, username, phone, or name).
 *
 * GET /api/admin/adaptive-teacher?userId=...
 * Load learner summary + stored adaptive teacher events.
 */
export async function GET(req: Request) {
  const auth = await assertAdmin();
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const userIdParam = url.searchParams.get("userId")?.trim() ?? "";
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (userIdParam) {
    if (!isUserId(userIdParam)) {
      return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
    }

    const userId = userIdParam as UserId;
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const [overallSkill, streak, completedLessons, eventCount, events] =
      await Promise.all([
        findUserOverallSkill(userId),
        getStreakForUser(userId),
        countQualifiedCompletedPartsForUser(userId),
        countAdaptiveTeacherEventsForUser(userId),
        listAdaptiveTeacherEventsForUser(userId),
      ]);

    const estimatedSkill = overallSkill ?? null;
    const latestEvent = events[0] ?? null;

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        englishLevel: user.englishLevel,
      },
      summary: {
        currentLevel:
          estimatedSkill != null
            ? skillToDisplayLevel(estimatedSkill)
            : user.englishLevel ?? "Unknown",
        estimatedSkill,
        confidence: latestEvent?.confidence ?? null,
        streak: streak.current,
        totalXp: user.xp,
        completedLessons,
        decisionCount: eventCount,
      },
      events,
    });
  }

  const users = await listUsersForAdmin({
    query: query || undefined,
    limit: query ? 50 : 100,
  });
  return NextResponse.json({
    users: users.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      name: row.name,
      phone: row.phone,
    })),
  });
}
