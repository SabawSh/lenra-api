import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getSavedVocabularyForUser } from "@/lib/db/savedVocabulary";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ cards: [] });
  }
  const cards = await getSavedVocabularyForUser(user.id);
  return NextResponse.json(JSON.parse(JSON.stringify({ cards })));
}
