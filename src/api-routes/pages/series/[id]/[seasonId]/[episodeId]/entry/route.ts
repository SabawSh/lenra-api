import { NextResponse } from "next/server";
import { isContentIdParam } from "@/lib/ids/contentId";
import { resolveEpisodeLegacyEntry } from "@/services/pages/episodeLegacyEntry";

export const runtime = "nodejs";

type Ctx = {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
};

export async function GET(req: Request, ctx: Ctx) {
  const { id, seasonId, episodeId } = await ctx.params;
  if (
    !isContentIdParam(id) ||
    !isContentIdParam(seasonId) ||
    !isContentIdParam(episodeId)
  ) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const order = url.searchParams.get("order") ?? undefined;
  const result = await resolveEpisodeLegacyEntry(
    id,
    seasonId,
    episodeId,
    order,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json(result);
}
