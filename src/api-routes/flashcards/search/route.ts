import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { pool } from "@/lib/db/connection";
import {
  findClipContextsForLemma,
  getPersonalFlashcardByNormalizedWord,
  personalFlashcardToJson,
} from "@/lib/db/queries/personalFlashcards";
import { lemmatizeWord } from "@/lib/dictionary/lemmatizeWord";
import { normalizeSavedVocabularyWord } from "@/lib/learning/vocabularySaveBridgeLogic";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";

/**
 * Read-only dictionary peek for flashcard search — does not enqueue
 * dictionary generation jobs or create pending entries.
 */
async function peekDictionary(lemma: string) {
  const [entries] = await pool.query<RowDataPacket[]>(
    `
    SELECT id, lemma, cefr_level
    FROM dictionary_entries
    WHERE lemma = ? AND language = 'en'
    LIMIT 1
    `,
    [lemma],
  );
  const entry = entries[0];
  if (!entry) return null;

  const [senses] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      id, sense_order, part_of_speech, cefr_level, ipa,
      definition_en, definition_fa
    FROM dictionary_senses
    WHERE dictionary_entry_id = ?
    ORDER BY sense_order ASC
    LIMIT 8
    `,
    [entry.id],
  );

  const senseIds = senses.map((s) => String(s.id));
  let examples: RowDataPacket[] = [];
  if (senseIds.length > 0) {
    const placeholders = senseIds.map(() => "?").join(",");
    const [exRows] = await pool.query<RowDataPacket[]>(
      `
      SELECT dictionary_sense_id, text_en, text_fa, example_order
      FROM dictionary_examples
      WHERE dictionary_sense_id IN (${placeholders})
      ORDER BY example_order ASC
      LIMIT 24
      `,
      senseIds,
    );
    examples = exRows;
  }

  return {
    id: String(entry.id),
    lemma: String(entry.lemma),
    cefrLevel: entry.cefr_level != null ? String(entry.cefr_level) : null,
    senses: senses.map((s) => ({
      id: String(s.id),
      partOfSpeech: s.part_of_speech != null ? String(s.part_of_speech) : null,
      ipa: s.ipa != null ? String(s.ipa) : null,
      definitionEn: s.definition_en != null ? String(s.definition_en) : null,
      definitionFa: s.definition_fa != null ? String(s.definition_fa) : null,
      examples: examples
        .filter((ex) => String(ex.dictionary_sense_id) === String(s.id))
        .map((ex) => ({
          textEn: String(ex.text_en ?? ""),
          textFa: String(ex.text_fa ?? ""),
        })),
    })),
  };
}

export async function GET(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const word = url.searchParams.get("word")?.trim() ?? "";
    const normalized = normalizeSavedVocabularyWord(word);
    if (!normalized) {
      return NextResponse.json({ error: "word_required" }, { status: 400 });
    }

    const lemma = lemmatizeWord(normalized);
    const personal = await getPersonalFlashcardByNormalizedWord(
      auth.user.id,
      normalized,
    );
    const dictionary = await peekDictionary(lemma);
    const dictionaryEntryId =
      personal?.dictionaryEntryId ?? dictionary?.id ?? null;
    const dictionarySenseId = personal?.dictionarySenseId ?? null;

    console.info("[flashcards/search] clip-context inputs", {
      flashcardId: personal?.id ?? null,
      query: word,
      normalized,
      lemma,
      dictionaryEntryId,
      dictionarySenseId,
      // Intentionally omitted: source partId / movieId — search is global.
    });

    const clipContexts = await findClipContextsForLemma(lemma, {
      limit: 36,
      perVideoLimit: 3,
      dictionaryEntryId,
      dictionarySenseId,
      surfaceWord: normalized,
    });

    const primarySense = dictionary?.senses[0] ?? null;
    const primaryExample = primarySense?.examples[0] ?? null;

    const hasLenra =
      dictionary != null ||
      clipContexts.length > 0;

    return NextResponse.json({
      query: word,
      normalized,
      lemma,
      personalCard: personal ? personalFlashcardToJson(personal) : null,
      dictionary,
      clipContexts,
      draftDefaults: {
        word: word.trim() || lemma,
        meaning: primarySense?.definitionFa || primarySense?.definitionEn || "",
        exampleSentence: primaryExample?.textEn || "",
        translation: primaryExample?.textFa || "",
        pronunciationIpa: primarySense?.ipa || "",
        dictionaryEntryId: dictionary?.id ?? null,
        dictionarySenseId: primarySense?.id ?? null,
      },
      mode: personal
        ? "already_saved"
        : hasLenra
          ? "lenra_hit"
          : "manual_draft",
    });
  } catch (err) {
    console.error("[flashcards] search error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
