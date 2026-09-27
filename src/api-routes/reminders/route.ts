import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  getUserReminderByPart,
  upsertUserReminderByPart,
} from "@/lib/db/queries/userReminders";
import { inferPreviousIntervalDays } from "@/lib/performance/reminder/spacing";
import { NextResponse } from "next/server";

/** Existing reminder for a part — used to grow spaced intervals on clean reviews. */
export async function GET(req: Request) {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;

  const partId = new URL(req.url).searchParams.get("partId")?.trim() ?? "";
  if (!partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const reminder = await getUserReminderByPart(auth.user.id, partId);
  if (!reminder) {
    return NextResponse.json({
      reminder: null,
      previousIntervalDays: null,
    });
  }

  return NextResponse.json({
    reminder: {
      id: reminder.id,
      partId: reminder.partId,
      dueAt: reminder.dueAt.toISOString(),
      updatedAt: reminder.updatedAt.toISOString(),
    },
    previousIntervalDays: inferPreviousIntervalDays(
      reminder.dueAt,
      reminder.updatedAt,
    ),
  });
}

export async function POST(req: Request) {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const body = (await req.json()) as { partId?: unknown; dueAt?: unknown };
  const partId: string = typeof body.partId === "string" ? body.partId : "";
  const dueAt: string = typeof body.dueAt === "string" ? body.dueAt : "";

  if (!partId || !dueAt) {
    return NextResponse.json(
      { error: "partId and dueAt are required" },
      { status: 400 },
    );
  }

  const reminder = await upsertUserReminderByPart(
    user.id,
    partId,
    new Date(dueAt),
  );

  return NextResponse.json({
    reminder: {
      id: reminder.id,
      userId: reminder.userId,
      partId: reminder.partId,
      dueAt: reminder.dueAt.toISOString(),
      createdAt: reminder.createdAt.toISOString(),
      updatedAt: reminder.updatedAt.toISOString(),
    },
  });
}
