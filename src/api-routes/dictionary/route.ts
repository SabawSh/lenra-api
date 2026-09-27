import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import {
  lookupDictionaryEntryById,
  lookupDictionaryEntryBySenseId,
  lookupDictionaryWord,
} from "@/lib/db/queries/dictionary";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    const senseId = url.searchParams.get("senseId")?.trim();
    const word = url.searchParams.get("word")?.trim();

    if (!id && !senseId && !word) {
      return NextResponse.json(
        { error: "id, senseId, or word query parameter is required" },
        { status: 400 },
      );
    }

    const user = await getCurrentUser();

    if (id) {
      try {
        const result = await lookupDictionaryEntryById(id, {
          userId: user?.id ?? null,
          displayWord: word,
        });

        return NextResponse.json(result, {
          headers: {
            "Cache-Control": "private, max-age=300",
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Dictionary entry not found"
        ) {
          return NextResponse.json(
            { error: "Dictionary entry not found" },
            { status: 404 },
          );
        }
        throw error;
      }
    }

    if (senseId) {
      try {
        const result = await lookupDictionaryEntryBySenseId(senseId, {
          userId: user?.id ?? null,
          displayWord: word,
        });

        return NextResponse.json(result, {
          headers: {
            "Cache-Control": "private, max-age=300",
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Dictionary sense not found"
        ) {
          return NextResponse.json(
            { error: "Dictionary sense not found" },
            { status: 404 },
          );
        }
        throw error;
      }
    }

    const result = await lookupDictionaryWord(word!, "en", {
      userId: user?.id ?? null,
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Dictionary lookup API error:", error);
    const message =
      process.env.NODE_ENV === "development" && error instanceof Error
        ? error.message
        : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
