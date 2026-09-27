import { NextResponse } from "next/server";
import { resolveMovieEntryRedirect } from "@/services/pages/movieEntryRedirect";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const order = url.searchParams.get("order") ?? undefined;
  const result = await resolveMovieEntryRedirect(id, order);
  if (!result.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
