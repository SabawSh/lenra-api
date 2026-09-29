import type { RowDataPacket } from "mysql2/promise";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { ContentRefreshValidation } from "./types";

async function tableExists(table: string): Promise<boolean> {
  const pool = getContentSyncPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT 1 AS ok
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    LIMIT 1
    `,
    [table],
  );
  return rows.length > 0;
}

export async function columnExists(table: string, column: string): Promise<boolean> {
  const pool = getContentSyncPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT 1 AS ok
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [table, column],
  );
  return rows.length > 0;
}

export async function buildContentRefreshValidation(
  episodeId: string,
  notes: string[] = [],
): Promise<ContentRefreshValidation> {
  const pool = getContentSyncPool();

  const hasCanonicalKey = await columnExists("parts", "canonical_key");
  const [partRows] = await pool.execute<RowDataPacket[]>(
    hasCanonicalKey
      ? `
    SELECT
      CAST(id AS CHAR) AS id,
      canonical_key AS canonicalKey,
      video_url AS videoUrl,
      hls_manifest_url AS hlsManifestUrl
    FROM parts
    WHERE episode_id = ?
    `
      : `
    SELECT
      CAST(id AS CHAR) AS id,
      NULL AS canonicalKey,
      video_url AS videoUrl,
      hls_manifest_url AS hlsManifestUrl
    FROM parts
    WHERE episode_id = ?
    `,
    [episodeId],
  );

  const partIds = partRows.map((r) => String(r.id));
  const keyCounts = new Map<string, number>();
  if (hasCanonicalKey) {
    for (const row of partRows) {
      const key = row.canonicalKey ? String(row.canonicalKey) : "";
      if (!key) continue;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }
  const uniqueCanonicalKeys = keyCounts.size;
  const duplicateCanonicalKeyGroups = [...keyCounts.values()].filter(
    (n) => n > 1,
  ).length;

  let translationCount = 0;
  let partsMissingTranslation = partIds.length;
  if (partIds.length > 0) {
    const [trRows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM caption_translations ct
      INNER JOIN parts p ON p.id = ct.part_id
      WHERE ct.language = 'fa'
        AND p.episode_id = ?
      `,
      [episodeId],
    );
    translationCount = Number(trRows[0]?.c ?? 0);

    const [missingTr] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM parts p
      LEFT JOIN caption_translations ct
        ON ct.part_id = p.id AND ct.language = 'fa'
      WHERE p.episode_id = ?
        AND ct.id IS NULL
      `,
      [episodeId],
    );
    partsMissingTranslation = Number(missingTr[0]?.c ?? 0);
  }

  let vocabularySensesInDb = 0;
  let vocabularyOccurrencesInDb = 0;
  let partsMissingVocabulary = partIds.length;
  if (await tableExists("dictionary_senses")) {
    const [senseRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM dictionary_senses`,
    );
    vocabularySensesInDb = Number(senseRows[0]?.c ?? 0);
  }
  if (await tableExists("part_vocabulary_occurrences") && partIds.length > 0) {
    const [occRows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM part_vocabulary_occurrences pvo
      INNER JOIN parts p ON p.id = pvo.part_id
      WHERE p.episode_id = ?
      `,
      [episodeId],
    );
    vocabularyOccurrencesInDb = Number(occRows[0]?.c ?? 0);

    const [missingVocab] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM parts p
      LEFT JOIN part_vocabulary_occurrences pvo ON pvo.part_id = p.id
      WHERE p.episode_id = ?
        AND pvo.id IS NULL
      `,
      [episodeId],
    );
    partsMissingVocabulary = Number(missingVocab[0]?.c ?? 0);
  }

  let grammarConceptsInDb = 0;
  let grammarOccurrencesInDb = 0;
  let partsMissingGrammar = partIds.length;
  if (await tableExists("grammar_concepts")) {
    const [gRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM grammar_concepts`,
    );
    grammarConceptsInDb = Number(gRows[0]?.c ?? 0);
  }
  if (await tableExists("part_grammar_occurrences") && partIds.length > 0) {
    const [goRows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM part_grammar_occurrences pgo
      INNER JOIN parts p ON p.id = pgo.part_id
      WHERE p.episode_id = ?
      `,
      [episodeId],
    );
    grammarOccurrencesInDb = Number(goRows[0]?.c ?? 0);

    const [missingG] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM parts p
      LEFT JOIN part_grammar_occurrences pgo ON pgo.part_id = p.id
      WHERE p.episode_id = ?
        AND pgo.id IS NULL
      `,
      [episodeId],
    );
    partsMissingGrammar = Number(missingG[0]?.c ?? 0);
  }

  const partsMissingMedia = partRows.filter(
    (r) => !r.videoUrl && !r.hlsManifestUrl,
  ).length;

  return {
    episodeId,
    pipelineClipCount: partIds.length,
    databasePartCount: partIds.length,
    uniqueCanonicalKeys,
    duplicateCanonicalKeyGroups,
    translationCount,
    partsMissingTranslation,
    vocabularySensesInDb,
    vocabularyOccurrencesInDb,
    partsMissingVocabulary,
    grammarConceptsInDb,
    grammarOccurrencesInDb,
    partsMissingGrammar,
    partsMissingMedia,
    notes,
  };
}
