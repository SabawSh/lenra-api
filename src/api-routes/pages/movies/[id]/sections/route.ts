import { NextResponse } from "next/server";
import { buildMovieSectionsPage } from "@/services/pages/movieSectionsPage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const result = await buildMovieSectionsPage(id);
  if (!result.ok) {
    if (result.reason === "learning_blocked") {
      return NextResponse.json({ error: "learning_blocked" }, { status: 403 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(result.payload);
}
