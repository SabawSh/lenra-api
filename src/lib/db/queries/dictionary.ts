import { randomUUID } from "node:crypto";

import { pool } from "@/lib/db/connection";
import { isDictionaryEntrySavedByUser } from "@/lib/db/queries/userVocabulary";
import { lemmatizeWord } from "@/lib/dictionary/lemmatizeWord";
import type {
  DictionaryEntryType,
  DictionaryExample,
  DictionarySense,
} from "@/lib/dictionary/types";
import type { RowDataPacket } from "mysql2/promise";

export type {
  DictionaryEntryType,
  DictionaryExample,
  DictionarySense,
} from "@/lib/dictionary/types";

export type DictionaryLookupResult = {
  id: string | null;
  word: string;
  lemma: string;
  entryType?: DictionaryEntryType;
  language?: string;
  cefrLevel?: string | null;
  senses: DictionarySense[];
  status: "ready" | "pending";
  saved?: boolean;
};

type DictionaryEntryRow = RowDataPacket & {
  id: string;
  lemma: string;
  entry_type?: DictionaryEntryType;
  language: string;
  status?: string;
  source?: string | null;
  cefr_level: string | null;
};

type DictionarySenseRow = RowDataPacket & {
  id: string;
  dictionary_entry_id: string;
  sense_order: number;
  part_of_speech: string | null;
  cefr_level: string | null;
  ipa: string | null;
  definition_en: string | null;
  definition_fa: string | null;
};

type DictionaryExampleRow = RowDataPacket & {
  dictionary_sense_id: string;
  text_en: string;
  text_fa: string;
  example_order: number;
};

const DICTIONARY_ENTRY_COLUMNS_WITH_STATUS = `
  id,
  lemma,
  entry_type,
  language,
  status,
  cefr_level
`;

const DICTIONARY_ENTRY_COLUMNS_WITH_SOURCE = `
  id,
  lemma,
  entry_type,
  language,
  source,
  cefr_level
`;

const DICTIONARY_ENTRY_COLUMNS_SOURCE_NO_ENTRY_TYPE = `
  id,
  lemma,
  language,
  source,
  cefr_level
`;

const DICTIONARY_ENTRY_COLUMNS_MINIMAL = `
  id,
  lemma,
  language,
  cefr_level
`;

const DICTIONARY_SENSE_COLUMNS = `
  id,
  dictionary_entry_id,
  sense_order,
  part_of_speech,
  cefr_level,
  ipa,
  definition_en,
  definition_fa
`;

function isBadFieldError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string };
  return row.code === "ER_BAD_FIELD_ERROR";
}

async function queryDictionaryEntryRow(
  whereClause: string,
  params: string[],
): Promise<DictionaryEntryRow | undefined> {
  const columnSets = [
    DICTIONARY_ENTRY_COLUMNS_WITH_STATUS,
    DICTIONARY_ENTRY_COLUMNS_WITH_SOURCE,
    DICTIONARY_ENTRY_COLUMNS_SOURCE_NO_ENTRY_TYPE,
    DICTIONARY_ENTRY_COLUMNS_MINIMAL,
  ];

  let lastError: unknown;

  for (const columns of columnSets) {
    try {
      const [rows] = await pool.execute<DictionaryEntryRow[]>(
        `
        SELECT
          ${columns}
        FROM dictionary_entries
        WHERE ${whereClause}
        LIMIT 1
        `,
        params,
      );
      return rows[0];
    } catch (error) {
      lastError = error;
      if (!isBadFieldError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function normalizeEntryType(
  raw: unknown,
): DictionaryEntryType | undefined {
  if (raw === "word" || raw === "phrase") {
    return raw;
  }
  return undefined;
}

function exampleRowToDictionaryExample(
  row: DictionaryExampleRow,
): DictionaryExample | null {
  const en = row.text_en?.trim();
  if (!en) {
    return null;
  }

  return {
    en,
    fa: row.text_fa?.trim() || "",
  };
}

async function fetchExamplesBySenseIds(
  senseIds: readonly string[],
): Promise<Map<string, DictionaryExample[]>> {
  if (senseIds.length === 0) {
    return new Map();
  }

  const placeholders = senseIds.map(() => "?").join(", ");
  const [rows] = await pool.execute<DictionaryExampleRow[]>(
    `
    SELECT
      dictionary_sense_id,
      text_en,
      text_fa,
      example_order
    FROM dictionary_examples
    WHERE dictionary_sense_id IN (${placeholders})
    ORDER BY example_order ASC, dictionary_sense_id ASC
    `,
    [...senseIds],
  );

  const examplesBySenseId = new Map<string, DictionaryExample[]>();

  for (const row of rows) {
    const example = exampleRowToDictionaryExample(row);
    if (!example) {
      continue;
    }

    const senseId = row.dictionary_sense_id;
    const existing = examplesBySenseId.get(senseId) ?? [];
    existing.push(example);
    examplesBySenseId.set(senseId, existing);
  }

  return examplesBySenseId;
}

function senseRowToDictionarySense(
  row: DictionarySenseRow,
  examples: DictionaryExample[],
): DictionarySense | null {
  const sense: DictionarySense = {
    id: row.id,
    partOfSpeech: row.part_of_speech?.trim() || null,
    cefrLevel: row.cefr_level?.trim() || null,
    ...(row.ipa?.trim() ? { ipa: row.ipa.trim() } : {}),
    definitionEn: row.definition_en?.trim() || null,
    definitionFa: row.definition_fa?.trim() || null,
    examples,
  };

  if (
    !sense.partOfSpeech &&
    !sense.cefrLevel &&
    !sense.definitionEn &&
    !sense.definitionFa &&
    sense.examples.length === 0
  ) {
    return null;
  }

  return sense;
}

async function fetchSensesForEntry(
  entryId: string,
): Promise<DictionarySense[]> {
  const [rows] = await pool.execute<DictionarySenseRow[]>(
    `
    SELECT
      ${DICTIONARY_SENSE_COLUMNS}
    FROM dictionary_senses
    WHERE dictionary_entry_id = ?
    ORDER BY sense_order ASC, cefr_level ASC, id ASC
    `,
    [entryId],
  );

  const examplesBySenseId = await fetchExamplesBySenseIds(
    rows.map((row) => row.id),
  );

  return rows
    .map((row) =>
      senseRowToDictionarySense(
        row,
        examplesBySenseId.get(row.id) ?? [],
      ),
    )
    .filter((sense): sense is DictionarySense => sense !== null);
}

async function fetchDictionaryEntryWithSenses(
  whereClause: string,
  params: string[],
): Promise<
  { entry: DictionaryEntryRow; senses: DictionarySense[] } | undefined
> {
  const entry = await queryDictionaryEntryRow(whereClause, params);
  if (!entry) {
    return undefined;
  }

  const senses = await fetchSensesForEntry(entry.id);
  return { entry, senses };
}

async function fetchDictionaryEntryRow(
  lemma: string,
  language: string,
): Promise<
  { entry: DictionaryEntryRow; senses: DictionarySense[] } | undefined
> {
  return fetchDictionaryEntryWithSenses("lemma = ? AND language = ?", [
    lemma,
    language,
  ]);
}

async function fetchDictionaryEntryRowById(
  id: string,
): Promise<
  { entry: DictionaryEntryRow; senses: DictionarySense[] } | undefined
> {
  return fetchDictionaryEntryWithSenses("id = ?", [id]);
}

async function fetchDictionaryEntryRowBySenseId(
  senseId: string,
): Promise<
  { entry: DictionaryEntryRow; senses: DictionarySense[] } | undefined
> {
  return fetchDictionaryEntryWithSenses(
    `id IN (
      SELECT dictionary_entry_id
      FROM dictionary_senses
      WHERE id = ?
    )`,
    [senseId],
  );
}

function normalizeLookupWord(word: string): string {
  return word
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

function isEntryPending(entry: DictionaryEntryRow): boolean {
  const status = entry.status?.trim().toLowerCase();
  if (status === "pending") return true;

  const source = entry.source?.trim().toLowerCase();
  return source === "pending";
}

function resolveLookupStatus(
  entry: DictionaryEntryRow,
  senses: DictionarySense[],
): "ready" | "pending" {
  if (isEntryPending(entry)) {
    return "pending";
  }
  return senses.length > 0 ? "ready" : "pending";
}

async function insertPendingDictionaryEntry(
  lemma: string,
  language: string,
): Promise<void> {
  const id = randomUUID();

  try {
    await pool.execute(
      `
      INSERT INTO dictionary_entries (
        id, lemma, language, status, created_at, updated_at
      )
      VALUES (?, ?, ?, 'pending', NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE updated_at = NOW(3)
      `,
      [id, lemma, language],
    );
    return;
  } catch (error) {
    if (!isBadFieldError(error)) {
      throw error;
    }
  }

  await pool.execute(
    `
    INSERT INTO dictionary_entries (
      id, lemma, language, source, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE updated_at = NOW(3)
    `,
    [id, lemma, language],
  );
}

async function enqueueDictionaryJob(lemma: string, language = "en"): Promise<void> {
  await pool.execute(
    `
    INSERT INTO dictionary_generation_jobs (
      id, lemma, language, status, attempts, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', 0, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE id = id
    `,
    [randomUUID(), lemma, language],
  );
}

function buildLookupResult(
  entry: DictionaryEntryRow,
  senses: DictionarySense[],
  normalized: string,
  saved?: boolean,
): DictionaryLookupResult {
  const entryType = normalizeEntryType(entry.entry_type);

  return {
    id: entry.id,
    word: normalized,
    lemma: entry.lemma,
    language: entry.language,
    cefrLevel: entry.cefr_level?.trim() || null,
    ...(entryType ? { entryType } : {}),
    senses,
    status: resolveLookupStatus(entry, senses),
    ...(saved !== undefined ? { saved } : {}),
  };
}

export async function lookupDictionaryWord(
  word: string,
  language = "en",
  options?: { userId?: string | null },
): Promise<DictionaryLookupResult> {
  const normalized = normalizeLookupWord(word);
  if (!normalized) {
    throw new Error("word query parameter is required");
  }

  const lemma = lemmatizeWord(normalized);
  let result = await fetchDictionaryEntryRow(lemma, language);

  if (!result) {
    await insertPendingDictionaryEntry(lemma, language);
    await enqueueDictionaryJob(lemma, language);
    result = await fetchDictionaryEntryRow(lemma, language);
  }

  if (!result) {
    return {
      id: null,
      word: normalized,
      lemma,
      language,
      senses: [],
      status: "pending",
    };
  }

  let saved: boolean | undefined;
  if (options?.userId && result.entry.id) {
    try {
      saved = await isDictionaryEntrySavedByUser(options.userId, result.entry.id);
    } catch (err) {
      console.error(
        "user_vocabulary saved check failed — run migrations/20250614_user_vocabulary.sql",
        err,
      );
      saved = false;
    }
  }

  return buildLookupResult(
    result.entry,
    result.senses,
    normalized,
    saved,
  );
}

export async function lookupDictionaryEntryById(
  id: string,
  options?: { userId?: string | null; displayWord?: string },
): Promise<DictionaryLookupResult> {
  const trimmedId = id.trim();
  if (!trimmedId) {
    throw new Error("id query parameter is required");
  }

  const result = await fetchDictionaryEntryRowById(trimmedId);
  if (!result) {
    throw new Error("Dictionary entry not found");
  }

  const displayWord =
    options?.displayWord?.trim() ||
    result.entry.lemma.trim() ||
    trimmedId;

  let saved: boolean | undefined;
  if (options?.userId) {
    try {
      saved = await isDictionaryEntrySavedByUser(options.userId, result.entry.id);
    } catch (err) {
      console.error(
        "user_vocabulary saved check failed — run migrations/20250614_user_vocabulary.sql",
        err,
      );
      saved = false;
    }
  }

  return buildLookupResult(
    result.entry,
    result.senses,
    displayWord,
    saved,
  );
}

export async function lookupDictionaryEntryBySenseId(
  senseId: string,
  options?: { userId?: string | null; displayWord?: string },
): Promise<DictionaryLookupResult> {
  const trimmedSenseId = senseId.trim();
  if (!trimmedSenseId) {
    throw new Error("senseId query parameter is required");
  }

  const result = await fetchDictionaryEntryRowBySenseId(trimmedSenseId);
  if (!result) {
    throw new Error("Dictionary sense not found");
  }

  const displayWord =
    options?.displayWord?.trim() ||
    result.entry.lemma.trim() ||
    trimmedSenseId;

  let saved: boolean | undefined;
  if (options?.userId) {
    try {
      saved = await isDictionaryEntrySavedByUser(options.userId, result.entry.id);
    } catch (err) {
      console.error(
        "user_vocabulary saved check failed — run migrations/20250614_user_vocabulary.sql",
        err,
      );
      saved = false;
    }
  }

  return buildLookupResult(
    result.entry,
    result.senses,
    displayWord,
    saved,
  );
}
