import { NextResponse } from "next/server";
import { getVideoWithSeasons } from "@/lib/db/series";
import { isContentIdParam } from "@/lib/ids/contentId";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isContentIdParam(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const video = await getVideoWithSeasons(id);
  return NextResponse.json({ video });
}
