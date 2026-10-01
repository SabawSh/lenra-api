import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  detachFlashcardContext,
  getPersonalFlashcardById,
  personalFlashcardToJson,
} from "@/lib/db/queries/personalFlashcards";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string; partId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id, partId } = await ctx.params;

    const ok = await detachFlashcardContext(auth.user.id, id, partId);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const card = await getPersonalFlashcardById(auth.user.id, id);
    return NextResponse.json({
      success: true,
      card: card ? personalFlashcardToJson(card) : null,
    });
  } catch (err) {
    console.error("[flashcards] detach context error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
