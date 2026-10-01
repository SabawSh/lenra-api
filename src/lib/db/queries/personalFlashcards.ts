/**
 * CRUD for personal_flashcards (+ contexts + events).
 * Separate from saved_vocabulary_cards (clip-context SRS).
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/connection";
import {
  JOIN_EPISODE_ON_CATALOG,
  JOIN_VIDEO_ON_CATALOG,
  PART_JOIN_PART_CATALOG,
} from "@/lib/db/sql/partCatalog";
import { normalizeSavedVocabularyWord } from "@/lib/learning/vocabularySaveBridgeLogic";
import type { UserId } from "@/types/schema";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type PersonalFlashcardImageSource =
  | "none"
  | "user_upload"
  | "ai_generated"
  | "lenra_context";

export type PersonalFlashcardSource =
  | "lenra_search"
  | "ai_draft"
  | "manual"
  | "from_movies";

export type PersonalFlashcardStatus = "draft" | "saved";

export type PersonalFlashcardEventType =
  | "created"
  | "updated"
  | "context_attached"
  | "clip_encountered"
  | "reviewed";

export type PersonalFlashcardContextCamel = {
  id: string;
  flashcardId: string;
  partId: string;
  sentenceSnapshot: string;
  translationSnapshot: string | null;
  previewImageUrl: string | null;
  createdAt: Date;
  movieTitle?: string | null;
  episodeTitle?: string | null;
  seasonNum?: number | null;
  episodeNum?: number | null;
};

export type PersonalFlashcardCamel = {
  id: string;
  userId: UserId;
  normalizedWord: string;
  word: string;
  meaning: string;
  exampleSentence: string;
  translation: string | null;
  pronunciationIpa: string | null;
  audioUrl: string | null;
  dictionaryEntryId: string | null;
  dictionarySenseId: string | null;
  imageUrl: string | null;
  imageSource: PersonalFlashcardImageSource;
  notes: string | null;
  source: PersonalFlashcardSource;
  status: PersonalFlashcardStatus;
  createdAt: Date;
  updatedAt: Date;
  contextCount: number;
  contexts?: PersonalFlashcardContextCamel[];
};

function mapFlashcard(
  row: Record<string, unknown>,
  contextCount = 0,
): PersonalFlashcardCamel {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    normalizedWord: String(row.normalized_word),
    word: String(row.word),
    meaning: String(row.meaning ?? ""),
    exampleSentence: String(row.example_sentence ?? ""),
    translation: row.translation != null ? String(row.translation) : null,
    pronunciationIpa:
      row.pronunciation_ipa != null ? String(row.pronunciation_ipa) : null,
    audioUrl: row.audio_url != null ? String(row.audio_url) : null,
    dictionaryEntryId:
      row.dictionary_entry_id != null
        ? String(row.dictionary_entry_id)
        : null,
    dictionarySenseId:
      row.dictionary_sense_id != null
        ? String(row.dictionary_sense_id)
        : null,
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    imageSource: (row.image_source as PersonalFlashcardImageSource) ?? "none",
    notes: row.notes != null ? String(row.notes) : null,
    source: (row.source as PersonalFlashcardSource) ?? "manual",
    status: (row.status as PersonalFlashcardStatus) ?? "saved",
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    contextCount:
      typeof row.context_count === "number"
        ? Number(row.context_count)
        : contextCount,
  };
}

function mapContext(
  row: Record<string, unknown>,
): PersonalFlashcardContextCamel {
  return {
    id: String(row.id),
    flashcardId: String(row.flashcard_id),
    partId: String(row.part_id),
    sentenceSnapshot: String(row.sentence_snapshot),
    translationSnapshot:
      row.translation_snapshot != null
        ? String(row.translation_snapshot)
        : null,
    previewImageUrl:
      row.preview_image_url != null ? String(row.preview_image_url) : null,
    createdAt: row.created_at as Date,
    movieTitle: row.movie_title != null ? String(row.movie_title) : null,
    episodeTitle:
      row.episode_title != null ? String(row.episode_title) : null,
    seasonNum: row.season_num != null ? Number(row.season_num) : null,
    episodeNum: row.episode_num != null ? Number(row.episode_num) : null,
  };
}

export function personalFlashcardToJson(card: PersonalFlashcardCamel) {
  return {
    id: card.id,
    userId: card.userId,
    normalizedWord: card.normalizedWord,
    word: card.word,
    meaning: card.meaning,
    exampleSentence: card.exampleSentence,
    translation: card.translation,
    pronunciationIpa: card.pronunciationIpa,
    audioUrl: card.audioUrl,
    dictionaryEntryId: card.dictionaryEntryId,
    dictionarySenseId: card.dictionarySenseId,
    imageUrl: card.imageUrl,
    imageSource: card.imageSource,
    notes: card.notes,
    source: card.source,
    status: card.status,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    contextCount: card.contextCount,
    contexts: card.contexts?.map((c) => ({
      id: c.id,
      flashcardId: c.flashcardId,
      partId: c.partId,
      sentenceSnapshot: c.sentenceSnapshot,
      translationSnapshot: c.translationSnapshot,
      previewImageUrl: c.previewImageUrl,
      createdAt: c.createdAt.toISOString(),
      movieTitle: c.movieTitle ?? null,
      episodeTitle: c.episodeTitle ?? null,
      seasonNum: c.seasonNum ?? null,
      episodeNum: c.episodeNum ?? null,
    })),
  };
}

export async function listPersonalFlashcardsForUser(
  userId: UserId,
  query?: string | null,
): Promise<PersonalFlashcardCamel[]> {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  const params: Array<string> = [userId];
  let where = "pf.user_id = ?";
  if (q) {
    where +=
      " AND (pf.normalized_word LIKE ? OR pf.word LIKE ? OR pf.meaning LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      pf.*,
      (
        SELECT COUNT(*)
        FROM personal_flashcard_contexts pfc
        WHERE pfc.flashcard_id = pf.id
      ) AS context_count
    FROM personal_flashcards pf
    WHERE ${where}
    ORDER BY pf.updated_at DESC
    `,
    params,
  );

  return rows.map((row) => mapFlashcard(row as Record<string, unknown>));
}

export async function getPersonalFlashcardById(
  userId: UserId,
  id: string,
): Promise<PersonalFlashcardCamel | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT pf.*,
      (
        SELECT COUNT(*)
        FROM personal_flashcard_contexts pfc
        WHERE pfc.flashcard_id = pf.id
      ) AS context_count
    FROM personal_flashcards pf
    WHERE pf.id = ? AND pf.user_id = ?
    LIMIT 1
    `,
    [id, userId],
  );
  const row = rows[0];
  if (!row) return null;
  const card = mapFlashcard(row as Record<string, unknown>);
  card.contexts = await listContextsForFlashcard(card.id);
  return card;
}

export async function getPersonalFlashcardByNormalizedWord(
  userId: UserId,
  normalizedWord: string,
): Promise<PersonalFlashcardCamel | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT pf.*,
      (
        SELECT COUNT(*)
        FROM personal_flashcard_contexts pfc
        WHERE pfc.flashcard_id = pf.id
      ) AS context_count
    FROM personal_flashcards pf
    WHERE pf.user_id = ? AND pf.normalized_word = ?
    LIMIT 1
    `,
    [userId, normalizedWord],
  );
  const row = rows[0];
  if (!row) return null;
  return mapFlashcard(row as Record<string, unknown>);
}

export async function listNormalizedWordsInFlashcards(
  userId: UserId,
  normalizedWords: string[],
): Promise<Set<string>> {
  if (normalizedWords.length === 0) return new Set();
  const placeholders = normalizedWords.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT normalized_word
    FROM personal_flashcards
    WHERE user_id = ? AND normalized_word IN (${placeholders})
    `,
    [userId, ...normalizedWords],
  );
  return new Set(rows.map((r) => String(r.normalized_word)));
}

export type UpsertPersonalFlashcardInput = {
  userId: UserId;
  word: string;
  meaning: string;
  exampleSentence: string;
  translation?: string | null;
  pronunciationIpa?: string | null;
  audioUrl?: string | null;
  dictionaryEntryId?: string | null;
  dictionarySenseId?: string | null;
  imageUrl?: string | null;
  imageSource?: PersonalFlashcardImageSource;
  notes?: string | null;
  source?: PersonalFlashcardSource;
  status?: PersonalFlashcardStatus;
};

export async function upsertPersonalFlashcard(
  input: UpsertPersonalFlashcardInput,
): Promise<{ card: PersonalFlashcardCamel; created: boolean }> {
  const normalizedWord = normalizeSavedVocabularyWord(input.word);
  if (!normalizedWord) {
    throw new Error("invalid_word");
  }

  const existing = await getPersonalFlashcardByNormalizedWord(
    input.userId,
    normalizedWord,
  );

  if (existing) {
    await pool.query(
      `
      UPDATE personal_flashcards SET
        word = ?,
        meaning = ?,
        example_sentence = ?,
        translation = ?,
        pronunciation_ipa = COALESCE(?, pronunciation_ipa),
        audio_url = COALESCE(?, audio_url),
        dictionary_entry_id = COALESCE(?, dictionary_entry_id),
        dictionary_sense_id = COALESCE(?, dictionary_sense_id),
        notes = COALESCE(?, notes),
        status = ?
      WHERE id = ? AND user_id = ?
      `,
      [
        input.word.trim() || normalizedWord,
        input.meaning.trim(),
        input.exampleSentence.trim(),
        input.translation?.trim() || null,
        input.pronunciationIpa?.trim() || null,
        input.audioUrl?.trim() || null,
        input.dictionaryEntryId ?? null,
        input.dictionarySenseId ?? null,
        input.notes?.trim() || null,
        input.status ?? "saved",
        existing.id,
        input.userId,
      ],
    );
    const card = await getPersonalFlashcardById(input.userId, existing.id);
    if (!card) throw new Error("Failed to reload personal flashcard");
    return { card, created: false };
  }

  const id = randomUUID();
  await pool.query(
    `
    INSERT INTO personal_flashcards (
      id, user_id, normalized_word, word,
      meaning, example_sentence, translation,
      pronunciation_ipa, audio_url,
      dictionary_entry_id, dictionary_sense_id,
      image_url, image_source, notes, source, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.userId,
      normalizedWord,
      input.word.trim() || normalizedWord,
      input.meaning.trim(),
      input.exampleSentence.trim(),
      input.translation?.trim() || null,
      input.pronunciationIpa?.trim() || null,
      input.audioUrl?.trim() || null,
      input.dictionaryEntryId ?? null,
      input.dictionarySenseId ?? null,
      input.imageUrl ?? null,
      input.imageSource ?? "none",
      input.notes?.trim() || null,
      input.source ?? "manual",
      input.status ?? "saved",
    ],
  );

  const card = await getPersonalFlashcardById(input.userId, id);
  if (!card) throw new Error("Failed to load created personal flashcard");
  return { card, created: true };
}

export async function updatePersonalFlashcard(
  userId: UserId,
  id: string,
  patch: Partial<{
    word: string;
    meaning: string;
    exampleSentence: string;
    translation: string | null;
    pronunciationIpa: string | null;
    notes: string | null;
    imageUrl: string | null;
    imageSource: PersonalFlashcardImageSource;
    status: PersonalFlashcardStatus;
  }>,
): Promise<PersonalFlashcardCamel | null> {
  const existing = await getPersonalFlashcardById(userId, id);
  if (!existing) return null;

  const word = patch.word?.trim() || existing.word;
  const normalizedWord = normalizeSavedVocabularyWord(word) || existing.normalizedWord;

  await pool.query(
    `
    UPDATE personal_flashcards SET
      word = ?,
      normalized_word = ?,
      meaning = ?,
      example_sentence = ?,
      translation = ?,
      pronunciation_ipa = ?,
      notes = ?,
      image_url = ?,
      image_source = ?,
      status = ?
    WHERE id = ? AND user_id = ?
    `,
    [
      word,
      normalizedWord,
      patch.meaning ?? existing.meaning,
      patch.exampleSentence ?? existing.exampleSentence,
      patch.translation !== undefined
        ? patch.translation
        : existing.translation,
      patch.pronunciationIpa !== undefined
        ? patch.pronunciationIpa
        : existing.pronunciationIpa,
      patch.notes !== undefined ? patch.notes : existing.notes,
      patch.imageUrl !== undefined ? patch.imageUrl : existing.imageUrl,
      patch.imageSource ?? existing.imageSource,
      patch.status ?? existing.status,
      id,
      userId,
    ],
  );

  return getPersonalFlashcardById(userId, id);
}

export async function deletePersonalFlashcard(
  userId: UserId,
  id: string,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM personal_flashcards WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.affectedRows > 0;
}

export async function listContextsForFlashcard(
  flashcardId: string,
): Promise<PersonalFlashcardContextCamel[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      pfc.*,
      pc.video_name AS movie_title,
      e.title AS episode_title,
      pc.season_num AS season_num,
      pc.episode_num AS episode_num
    FROM personal_flashcard_contexts pfc
    INNER JOIN parts p ON p.id = pfc.part_id
    ${PART_JOIN_PART_CATALOG}
    LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
    WHERE pfc.flashcard_id = ?
    ORDER BY pfc.created_at DESC
    `,
    [flashcardId],
  );
  return rows.map((r) => mapContext(r as Record<string, unknown>));
}

export async function attachFlashcardContext(input: {
  userId: UserId;
  flashcardId: string;
  partId: string;
  sentenceSnapshot: string;
  translationSnapshot?: string | null;
  previewImageUrl?: string | null;
}): Promise<PersonalFlashcardContextCamel> {
  const card = await getPersonalFlashcardById(input.userId, input.flashcardId);
  if (!card) throw new Error("flashcard_not_found");

  const id = randomUUID();
  await pool.query(
    `
    INSERT INTO personal_flashcard_contexts (
      id, flashcard_id, part_id,
      sentence_snapshot, translation_snapshot, preview_image_url
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sentence_snapshot = VALUES(sentence_snapshot),
      translation_snapshot = VALUES(translation_snapshot),
      preview_image_url = COALESCE(VALUES(preview_image_url), preview_image_url)
    `,
    [
      id,
      input.flashcardId,
      input.partId,
      input.sentenceSnapshot,
      input.translationSnapshot ?? null,
      input.previewImageUrl ?? null,
    ],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT * FROM personal_flashcard_contexts
    WHERE flashcard_id = ? AND part_id = ?
    LIMIT 1
    `,
    [input.flashcardId, input.partId],
  );
  return mapContext(rows[0] as Record<string, unknown>);
}

export async function detachFlashcardContext(
  userId: UserId,
  flashcardId: string,
  partId: string,
): Promise<boolean> {
  const card = await getPersonalFlashcardById(userId, flashcardId);
  if (!card) return false;
  const [result] = await pool.query<ResultSetHeader>(
    `
    DELETE FROM personal_flashcard_contexts
    WHERE flashcard_id = ? AND part_id = ?
    `,
    [flashcardId, partId],
  );
  return result.affectedRows > 0;
}

export async function insertFlashcardEvent(input: {
  userId: UserId;
  flashcardId: string;
  eventType: PersonalFlashcardEventType;
  partId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  await pool.query(
    `
    INSERT INTO personal_flashcard_events (
      user_id, flashcard_id, event_type, part_id, payload_json
    ) VALUES (?, ?, ?, ?, ?)
    `,
    [
      input.userId,
      input.flashcardId,
      input.eventType,
      input.partId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
    ],
  );
}

/** Deduped clip encounter within the last 24h for same user+card+part. */
export async function logClipEncounterOnce(input: {
  userId: UserId;
  flashcardId: string;
  partId: string;
  payload?: Record<string, unknown> | null;
}): Promise<boolean> {
  const [existing] = await pool.query<RowDataPacket[]>(
    `
    SELECT id FROM personal_flashcard_events
    WHERE user_id = ?
      AND flashcard_id = ?
      AND part_id = ?
      AND event_type = 'clip_encountered'
      AND created_at >= (UTC_TIMESTAMP(3) - INTERVAL 1 DAY)
    LIMIT 1
    `,
    [input.userId, input.flashcardId, input.partId],
  );
  if (existing.length > 0) return false;
  await insertFlashcardEvent({
    userId: input.userId,
    flashcardId: input.flashcardId,
    eventType: "clip_encountered",
    partId: input.partId,
    payload: input.payload ?? null,
  });
  return true;
}

export type ClipContextHit = {
  partId: string;
  sentence: string;
  translation: string | null;
  previewImageUrl: string | null;
  movieTitle: string | null;
  episodeTitle: string | null;
  seasonNum: number | null;
  episodeNum: number | null;
  surface: string | null;
  videoId: string | null;
};

export type FindClipContextsOptions = {
  /** Max scenes overall (after per-video diversification). Default 36. */
  limit?: number;
  /** Max scenes from the same movie/series. Default 3. */
  perVideoLimit?: number;
  dictionaryEntryId?: string | null;
  dictionarySenseId?: string | null;
  /** Original typed/surface form for caption fallback (optional). */
  surfaceWord?: string | null;
};

function mapClipContextRow(r: RowDataPacket): ClipContextHit {
  return {
    partId: String(r.part_id),
    sentence: String(r.sentence ?? ""),
    translation: r.translation != null ? String(r.translation) : null,
    previewImageUrl:
      r.preview_image_url != null ? String(r.preview_image_url) : null,
    movieTitle: r.movie_title != null ? String(r.movie_title) : null,
    episodeTitle: r.episode_title != null ? String(r.episode_title) : null,
    seasonNum: r.season_num != null ? Number(r.season_num) : null,
    episodeNum: r.episode_num != null ? Number(r.episode_num) : null,
    surface: r.surface != null ? String(r.surface) : null,
    videoId: r.video_id != null ? String(r.video_id) : null,
  };
}

const CLIP_CONTEXT_SELECT = `
  p.id AS part_id,
  p.text AS sentence,
  (
    SELECT ct.text FROM caption_translations ct
    WHERE ct.part_id = p.id AND ct.language = 'fa'
    ORDER BY ct.id ASC LIMIT 1
  ) AS translation,
  COALESCE(e.cover_url, s.cover_url, v.cover_url) AS preview_image_url,
  pc.video_name AS movie_title,
  e.title AS episode_title,
  pc.season_num AS season_num,
  pc.episode_num AS episode_num,
  CAST(pc.video_id AS CHAR) AS video_id
`;

const CLIP_CONTEXT_JOINS = `
  ${PART_JOIN_PART_CATALOG}
  LEFT JOIN episodes e ON ${JOIN_EPISODE_ON_CATALOG("pc", "e")}
  LEFT JOIN seasons s ON s.id = pc.season_id
  LEFT JOIN videos v ON ${JOIN_VIDEO_ON_CATALOG("pc", "v")}
`;

function escapeMysqlRegexpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * After global retrieval: keep ≤ perVideoLimit scenes per movie, then cap total.
 * Never filters by source movie — only presentation.
 */
function diversifyClipContexts(
  hits: ClipContextHit[],
  perVideoLimit: number,
  limit: number,
): ClipContextHit[] {
  const perVideo = new Map<string, number>();
  const out: ClipContextHit[] = [];
  for (const hit of hits) {
    const key = hit.videoId?.trim() || `part:${hit.partId}`;
    const used = perVideo.get(key) ?? 0;
    if (used >= perVideoLimit) continue;
    perVideo.set(key, used + 1);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

function buildDictionaryIdentityWhere(
  aliasEntry: string,
  aliasSense: string | null,
  opts: {
    entryId: string | null;
    senseId: string | null;
    lemma: string;
  },
): { sql: string; params: string[] } {
  const { entryId, senseId, lemma } = opts;
  // Priority: dictionary_entry_id → dictionary_sense_id → lemma.
  // When entryId is set, also OR-match lemma so duplicate dictionary rows
  // for the same word in other titles are not dropped.
  if (entryId && lemma) {
    return {
      sql: `(${aliasEntry}.id = ? OR LOWER(${aliasEntry}.lemma) = ?)`,
      params: [entryId, lemma],
    };
  }
  if (entryId) {
    return { sql: `${aliasEntry}.id = ?`, params: [entryId] };
  }
  if (senseId && aliasSense) {
    return { sql: `${aliasSense}.id = ?`, params: [senseId] };
  }
  if (lemma) {
    return { sql: `LOWER(${aliasEntry}.lemma) = ?`, params: [lemma] };
  }
  return { sql: "1 = 0", params: [] };
}

/**
 * Global movie-clip contexts for a flashcard word.
 * Never scoped to the original save movie/part / personal_flashcard_contexts.
 *
 * Retrieval (merge all sources, then diversify):
 * 1. part_vocabulary_occurrences (dictionary identity)
 * 2. part_dictionary_entries (dictionary identity)
 * 3. caption text match on parts (covers titles without vocab index)
 *
 * Presentation only after merge: ≤ perVideoLimit per video, then limit.
 */
export async function findClipContextsForLemma(
  lemma: string,
  limitOrOpts: number | FindClipContextsOptions = 36,
): Promise<ClipContextHit[]> {
  const opts: FindClipContextsOptions =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
  const perVideoLimit = Math.max(1, opts.perVideoLimit ?? 3);
  const limit = Math.max(perVideoLimit, opts.limit ?? 36);
  const normalized = normalizeSavedVocabularyWord(lemma);
  const entryId = opts.dictionaryEntryId?.trim() || null;
  const senseId = opts.dictionarySenseId?.trim() || null;
  const lemmaKey = normalized;

  if (!lemmaKey && !entryId && !senseId) return [];

  // Fetch a wide global candidate set; diversify in-process after merge.
  const candidateCap = Math.max(limit * 8, 120);

  const occIdentity = buildDictionaryIdentityWhere("de", "ds", {
    entryId,
    senseId,
    lemma: lemmaKey,
  });

  const [occurrenceRows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      ${CLIP_CONTEXT_SELECT},
      pvo.surface AS surface,
      pvo.confidence AS sort_score
    FROM part_vocabulary_occurrences pvo
    INNER JOIN dictionary_senses ds ON ds.id = pvo.sense_id
    INNER JOIN dictionary_entries de ON de.id = ds.dictionary_entry_id
    INNER JOIN parts p ON p.id = pvo.part_id
    ${CLIP_CONTEXT_JOINS}
    WHERE ${occIdentity.sql}
      AND (p.retired_at IS NULL)
    ORDER BY pvo.confidence DESC, p.created_at DESC
    LIMIT ?
    `,
    [...occIdentity.params, candidateCap],
  );

  const pdeIdentity = buildDictionaryIdentityWhere("de", null, {
    entryId,
    // PDE has no sense column — fall through to lemma when only senseId set.
    senseId: null,
    lemma: lemmaKey,
  });

  const [pdeRows] =
    pdeIdentity.params.length > 0
      ? await pool.query<RowDataPacket[]>(
          `
          SELECT
            ${CLIP_CONTEXT_SELECT},
            NULL AS surface,
            pde.frequency AS sort_score
          FROM part_dictionary_entries pde
          INNER JOIN dictionary_entries de ON de.id = pde.dictionary_entry_id
          INNER JOIN parts p ON p.id = pde.part_id
          ${CLIP_CONTEXT_JOINS}
          WHERE ${pdeIdentity.sql}
            AND (p.retired_at IS NULL)
          ORDER BY pde.frequency DESC, p.created_at DESC
          LIMIT ?
          `,
          [...pdeIdentity.params, candidateCap],
        )
      : [[] as RowDataPacket[]];

  // Caption fallback: vocab/dictionary indexes may only cover one title;
  // other movies still have the word in parts.text.
  const searchForms = Array.from(
    new Set(
      [lemmaKey, opts.surfaceWord, lemma]
        .map((w) => normalizeSavedVocabularyWord(w ?? ""))
        .filter((w) => w.length >= 2),
    ),
  );

  let textRows: RowDataPacket[] = [];
  if (searchForms.length > 0) {
    const textClauses = searchForms.map(
      () =>
        `LOWER(p.text) REGEXP CONCAT('(^|[^a-z0-9])', ?, '([^a-z0-9]|$)')`,
    );
    const textParams = searchForms.map(escapeMysqlRegexpLiteral);
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT
        ${CLIP_CONTEXT_SELECT},
        NULL AS surface,
        0 AS sort_score
      FROM parts p
      ${CLIP_CONTEXT_JOINS}
      WHERE (p.retired_at IS NULL)
        AND (${textClauses.join(" OR ")})
      ORDER BY pc.video_name ASC, p.created_at DESC
      LIMIT ?
      `,
      [...textParams, candidateCap],
    );
    textRows = rows;
  }

  // Merge: dictionary-linked first, then caption hits. Dedupe by part.
  const seen = new Set<string>();
  const merged: ClipContextHit[] = [];
  for (const row of [...occurrenceRows, ...pdeRows, ...textRows]) {
    const partId = String(row.part_id);
    if (seen.has(partId)) continue;
    seen.add(partId);
    merged.push(mapClipContextRow(row));
  }

  // Stable-ish order: movie title, then original merge priority already applied.
  merged.sort((a, b) => {
    const ma = a.movieTitle ?? "";
    const mb = b.movieTitle ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return a.partId.localeCompare(b.partId);
  });

  const diversified = diversifyClipContexts(merged, perVideoLimit, limit);

  console.info("[flashcards] findClipContextsForLemma", {
    lemma: lemmaKey,
    entryId,
    senseId,
    occurrenceHits: occurrenceRows.length,
    pdeHits: pdeRows.length,
    textHits: textRows.length,
    mergedUnique: merged.length,
    distinctVideosBefore: new Set(
      merged.map((h) => h.videoId ?? h.movieTitle ?? h.partId),
    ).size,
    returned: diversified.length,
    moviesReturned: [
      ...new Set(diversified.map((h) => h.movieTitle).filter(Boolean)),
    ],
  });

  return diversified;
}

export type FlashcardEncounterHit = {
  flashcardId: string;
  word: string;
  meaning: string;
  normalizedWord: string;
  partId: string;
  sentence: string;
  translation: string | null;
};

/** Personal flashcards whose lemma appears in this part via occurrences. */
export async function findEncountersForPart(
  userId: UserId,
  partId: string,
): Promise<FlashcardEncounterHit[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT DISTINCT
      pf.id AS flashcard_id,
      pf.word,
      pf.meaning,
      pf.normalized_word,
      p.id AS part_id,
      p.text AS sentence,
      (
        SELECT ct.text FROM caption_translations ct
        WHERE ct.part_id = p.id AND ct.language = 'fa'
        ORDER BY ct.id ASC LIMIT 1
      ) AS translation
    FROM personal_flashcards pf
    INNER JOIN dictionary_entries de
      ON de.id = pf.dictionary_entry_id
      OR de.lemma = pf.normalized_word
    INNER JOIN dictionary_senses ds ON ds.dictionary_entry_id = de.id
    INNER JOIN part_vocabulary_occurrences pvo
      ON pvo.sense_id = ds.id AND pvo.part_id = ?
    INNER JOIN parts p ON p.id = pvo.part_id
    WHERE pf.user_id = ?
    LIMIT 20
    `,
    [partId, userId],
  );

  if (rows.length > 0) {
    return rows.map((r) => ({
      flashcardId: String(r.flashcard_id),
      word: String(r.word),
      meaning: String(r.meaning ?? ""),
      normalizedWord: String(r.normalized_word),
      partId: String(r.part_id),
      sentence: String(r.sentence ?? ""),
      translation: r.translation != null ? String(r.translation) : null,
    }));
  }

  // Fallback without senses: match lemma via part_dictionary_entries
  const [fallback] = await pool.query<RowDataPacket[]>(
    `
    SELECT DISTINCT
      pf.id AS flashcard_id,
      pf.word,
      pf.meaning,
      pf.normalized_word,
      p.id AS part_id,
      p.text AS sentence,
      (
        SELECT ct.text FROM caption_translations ct
        WHERE ct.part_id = p.id AND ct.language = 'fa'
        ORDER BY ct.id ASC LIMIT 1
      ) AS translation
    FROM personal_flashcards pf
    INNER JOIN dictionary_entries de ON de.lemma = pf.normalized_word
    INNER JOIN part_dictionary_entries pde
      ON pde.dictionary_entry_id = de.id AND pde.part_id = ?
    INNER JOIN parts p ON p.id = pde.part_id
    WHERE pf.user_id = ?
    LIMIT 20
    `,
    [partId, userId],
  );

  return fallback.map((r) => ({
    flashcardId: String(r.flashcard_id),
    word: String(r.word),
    meaning: String(r.meaning ?? ""),
    normalizedWord: String(r.normalized_word),
    partId: String(r.part_id),
    sentence: String(r.sentence ?? ""),
    translation: r.translation != null ? String(r.translation) : null,
  }));
}
