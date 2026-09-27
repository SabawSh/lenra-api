import { NextResponse } from "next/server";
import { buildEpisodeSectionsPage } from "@/services/pages/episodeSectionsPage";

export const runtime = "nodejs";

type Ctx = {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
};

export async function GET(_req: Request, ctx: Ctx) {
  const { id, seasonId, episodeId } = await ctx.params;
  const result = await buildEpisodeSectionsPage(id, seasonId, episodeId);
  if (!result.ok) {
    if (result.reason === "learning_blocked") {
      return NextResponse.json({ error: "learning_blocked" }, { status: 403 });
    }
    if (result.reason === "wrong_type") {
      return NextResponse.json({ error: "wrong_type" }, { status: 404 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(result.payload);
}
