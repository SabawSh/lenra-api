import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { setVideoIsLiked } from "@/lib/db/likedVideos";
import { fetchVideoIsLikedByIdOnly } from "@/lib/db/queries/videos";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ videoId: string }> };

/**
 * POST /api/videos/[videoId]/like
 * Body: { isLiked?: boolean } — omit to toggle.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { videoId } = await params;
  const id = videoId?.trim();
  if (!id) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  let isLiked: boolean | undefined;
  try {
    const body = (await req.json()) as { isLiked?: unknown };
    if (typeof body?.isLiked === "boolean") {
      isLiked = body.isLiked;
    }
  } catch {
    // Empty body — toggle below.
  }

  try {
    if (isLiked === undefined) {
      const current = await fetchVideoIsLikedByIdOnly(id);
      if (current === null) {
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
      }
      isLiked = !current;
    }

    const saved = await setVideoIsLiked(id, isLiked);
    revalidateTag("videos", { expire: 0 });
    return NextResponse.json({ isLiked: saved });
  } catch (err) {
    if (err instanceof Error && err.message === "VIDEO_NOT_FOUND") {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    throw err;
  }
}
