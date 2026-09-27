import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { saveUserVideoLastSeen } from "@/lib/db/lastSeen";
import { userCanAccessLearning } from "@/lib/payments/access";

export const runtime = "nodejs";

type Body = {
  videoId?: string;
  order?: number;
  seasonId?: string;
  episodeId?: string;
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

  const { videoId, order, seasonId, episodeId } = body;
  if (typeof videoId !== "string" || typeof order !== "number" || order < 1) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await saveUserVideoLastSeen({
    userId: user.id,
    videoId,
    order,
    seasonId,
    episodeId,
  });

  return NextResponse.json({ ok: true });
}
