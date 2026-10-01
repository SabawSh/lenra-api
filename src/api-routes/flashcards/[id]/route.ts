import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  deletePersonalFlashcard,
  getPersonalFlashcardById,
  insertFlashcardEvent,
  personalFlashcardToJson,
  updatePersonalFlashcard,
  type PersonalFlashcardImageSource,
} from "@/lib/db/queries/personalFlashcards";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const card = await getPersonalFlashcardById(auth.user.id, id);
    if (!card) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ card: personalFlashcardToJson(card) });
  } catch (err) {
    console.error("[flashcards] GET by id error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    const card = await updatePersonalFlashcard(auth.user.id, id, {
      word: typeof body.word === "string" ? body.word : undefined,
      meaning: typeof body.meaning === "string" ? body.meaning : undefined,
      exampleSentence:
        typeof body.exampleSentence === "string"
          ? body.exampleSentence
          : undefined,
      translation:
        body.translation === null
          ? null
          : typeof body.translation === "string"
            ? body.translation
            : undefined,
      pronunciationIpa:
        body.pronunciationIpa === null
          ? null
          : typeof body.pronunciationIpa === "string"
            ? body.pronunciationIpa
            : undefined,
      notes:
        body.notes === null
          ? null
          : typeof body.notes === "string"
            ? body.notes
            : undefined,
      imageUrl:
        body.imageUrl === null
          ? null
          : typeof body.imageUrl === "string"
            ? body.imageUrl
            : undefined,
      imageSource:
        typeof body.imageSource === "string"
          ? (body.imageSource as PersonalFlashcardImageSource)
          : undefined,
    });

    if (!card) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await insertFlashcardEvent({
      userId: auth.user.id,
      flashcardId: card.id,
      eventType: "updated",
    });

    return NextResponse.json({
      success: true,
      card: personalFlashcardToJson(card),
    });
  } catch (err) {
    console.error("[flashcards] PATCH error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;
    const ok = await deletePersonalFlashcard(auth.user.id, id);
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[flashcards] DELETE error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
