import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  deleteSavedVocabularyCardForUser,
  fetchReviewStrengthForUserCard,
  savedCardToJson,
  updateSavedCardAfterReview,
} from "@/lib/db/queries/savedVocabularyCards";
import { NextResponse } from "next/server";

type ReviewOutcome = "got-it" | "almost" | "need-practice";

function scheduleForOutcome(outcome: ReviewOutcome, currentStrength: number) {
  const nextReviewAt = new Date();
  let reviewStrength = currentStrength;
  let days = 1;

  if (outcome === "got-it") {
    reviewStrength = Math.min(currentStrength + 1, 5);
    days = 8 + reviewStrength * 4;
  } else if (outcome === "almost") {
    reviewStrength = Math.max(currentStrength, 1);
    days = 4;
  } else {
    reviewStrength = Math.max(currentStrength - 1, 0);
    days = 1;
  }

  nextReviewAt.setDate(nextReviewAt.getDate() + days);
  return { reviewStrength, nextReviewAt };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const { id } = await params;
    const cardId = Number(id);
    const body = (await req.json()) as { outcome?: unknown };
    const outcome = body?.outcome as ReviewOutcome | undefined;

    if (
      !cardId ||
      (outcome !== "got-it" &&
        outcome !== "almost" &&
        outcome !== "need-practice")
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const existingStrength = await fetchReviewStrengthForUserCard(
      cardId,
      user.id,
    );

    if (existingStrength == null) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    const schedule = scheduleForOutcome(outcome, existingStrength);
    const reviewedAt = new Date();
    const card = await updateSavedCardAfterReview({
      cardId,
      userId: user.id,
      reviewStrength: schedule.reviewStrength,
      nextReviewAt: schedule.nextReviewAt,
      lastReviewedAt: reviewedAt,
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, card: savedCardToJson(card) });
  } catch (err) {
    console.error("Vocabulary review API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const { id } = await params;
    const cardId = Number(id);
    if (!cardId) {
      return NextResponse.json({ error: "Invalid card id" }, { status: 400 });
    }

    const ok = await deleteSavedVocabularyCardForUser(cardId, user.id);

    if (!ok) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Vocabulary delete API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
