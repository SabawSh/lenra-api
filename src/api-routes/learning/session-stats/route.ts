import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getLearningSessionStats } from "@/lib/db/learningSessionStats";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  const stats = await getLearningSessionStats(user?.id ?? null);
  return NextResponse.json(stats);
}
