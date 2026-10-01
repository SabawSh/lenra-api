import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  findEncountersForPart,
  logClipEncounterOnce,
} from "@/lib/db/queries/personalFlashcards";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const partId = url.searchParams.get("partId")?.trim() ?? "";
    if (!partId) {
      return NextResponse.json({ error: "partId_required" }, { status: 400 });
    }

    const hits = await findEncountersForPart(auth.user.id, partId);
    const ack = url.searchParams.get("ack") === "1";

    if (ack) {
      for (const hit of hits) {
        await logClipEncounterOnce({
          userId: auth.user.id,
          flashcardId: hit.flashcardId,
          partId: hit.partId,
          payload: { word: hit.word },
        });
      }
    }

    return NextResponse.json({
      partId,
      encounters: hits,
    });
  } catch (err) {
    console.error("[flashcards] encounters error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
