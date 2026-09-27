import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";
import {
  getUserLastPositionForEpisode,
  saveUserEpisodeLastPosition,
} from "@/lib/db/lastSeen";
import { isContentIdParam } from "@/lib/ids/contentId";
import { NextRequest, NextResponse } from "next/server";

type PostBody = {
  videoId?: string;
  seasonId?: string;
  sectionIndex?: number;
  partInSection?: number;
};

function parsePostBody(raw: unknown): PostBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    videoId: typeof o.videoId === "string" ? o.videoId : undefined,
    seasonId: typeof o.seasonId === "string" ? o.seasonId : undefined,
    sectionIndex:
      typeof o.sectionIndex === "number" ? o.sectionIndex : undefined,
    partInSection:
      typeof o.partInSection === "number" ? o.partInSection : undefined,
  };
}

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  const videoId = req.nextUrl.searchParams.get("videoId");

  if (!isContentIdParam(episodeId) || typeof videoId !== "string") {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  if (!isContentIdParam(videoId)) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ position: null });
  }

  const position = await getUserLastPositionForEpisode(
    user.id,
    videoId,
    episodeId,
  );
  return NextResponse.json({ position });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await props.params;
  if (!isContentIdParam(episodeId)) {
    return NextResponse.json({ error: "Invalid episode id" }, { status: 400 });
  }

  let body: PostBody | null = null;
  try {
    body = parsePostBody(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { videoId, seasonId, sectionIndex, partInSection } = body ?? {};
  if (
    typeof videoId !== "string" ||
    typeof seasonId !== "string" ||
    !isContentIdParam(videoId) ||
    !isContentIdParam(seasonId) ||
    typeof sectionIndex !== "number" ||
    !Number.isFinite(sectionIndex) ||
    sectionIndex < 1 ||
    typeof partInSection !== "number" ||
    !Number.isFinite(partInSection) ||
    partInSection < 1
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

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

  await saveUserEpisodeLastPosition({
    userId: user.id,
    videoId,
    seasonId,
    episodeId,
    sectionIndex,
    partInSection,
  });

  return NextResponse.json({ ok: true });
}
