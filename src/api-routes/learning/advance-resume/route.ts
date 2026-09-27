import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { advanceLearningResume } from "@/lib/db/learningResume";
import { userCanAccessLearning } from "@/lib/payments/access";

export const runtime = "nodejs";

type Body = {
  videoId?: string;
  seasonId?: string;
  episodeId?: string;
  resumeSection?: number;
  resumePart?: number;
  unlockAtLeast?: number;
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: true });
  }
  if (!(await userCanAccessLearning(user))) {
    return NextResponse.json(
      { error: "subscription_required" },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    videoId,
    seasonId,
    episodeId,
    resumeSection,
    resumePart,
    unlockAtLeast,
  } = body;

  if (
    typeof videoId !== "string" ||
    typeof resumeSection !== "number" ||
    typeof resumePart !== "number"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await advanceLearningResume({
    userId: user.id,
    videoId,
    seasonId,
    episodeId,
    resumeSection,
    resumePart,
    unlockAtLeast,
  });

  return NextResponse.json({ ok: true });
}
