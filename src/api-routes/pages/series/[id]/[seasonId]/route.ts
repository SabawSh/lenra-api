import { NextResponse } from "next/server";
import { getSeasonWithEpisodes } from "@/lib/db/series";
import { isContentIdParam } from "@/lib/ids/contentId";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; seasonId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, seasonId } = await ctx.params;
  if (!isContentIdParam(id) || !isContentIdParam(seasonId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const video = await getSeasonWithEpisodes(id, seasonId);
  return NextResponse.json({ video });
}
