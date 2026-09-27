import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { awardXp } from "@/lib/gamification/awardXp";
import {
  getGamificationProgress,
  isXpReason,
} from "@/lib/gamification/xp";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

type XpBody = {
  reason?: string;
  amount?: number;
};

export async function POST(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as XpBody;
    const reason = body.reason?.trim();

    if (!reason || !isXpReason(reason)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    const amount =
      typeof body.amount === "number" && body.amount > 0
        ? Math.round(body.amount)
        : 0;
    if (amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const result = await awardXp({ userId: user.id, amount, reason });
    const progression = getGamificationProgress(result.totalXp);

    revalidateTag("user", { expire: 0 });

    return NextResponse.json({
      success: true,
      award: result,
      progression,
    });
  } catch (err) {
    console.error("[gamification/xp]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
