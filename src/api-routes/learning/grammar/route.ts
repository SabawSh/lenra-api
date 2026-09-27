import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getGrammarForPartIds, MAX_PART_IDS } from "@/lib/db/queries/partGrammar";
import { uniquePartIds } from "@/lib/learning/grammarForParts";
import { NextResponse } from "next/server";

/**
 * GET /api/learning/grammar?partIds=id1,id2
 * Returns grammar concepts grouped for the current learning unit parts.
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const raw = url.searchParams.get("partIds")?.trim() ?? "";
    if (!raw) {
      return NextResponse.json(
        { error: "partIds query parameter is required" },
        { status: 400 },
      );
    }

    const partIds = uniquePartIds(raw.split(",")).slice(0, MAX_PART_IDS);
    if (partIds.length === 0) {
      return NextResponse.json(
        { error: "partIds query parameter is required" },
        { status: 400 },
      );
    }

    const result = await getGrammarForPartIds(partIds);
    // Part-scoped Grammar must not be HTTP-cached across content replace / catalog demotions.
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[api/learning/grammar]", error);
    return NextResponse.json(
      { error: "Failed to load grammar" },
      { status: 500 },
    );
  }
}
