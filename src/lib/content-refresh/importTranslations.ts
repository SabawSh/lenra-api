import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { DbExecutor } from "./resetEpisodeParts";
import type { TranslationEntry } from "./types";

const LANGUAGE = "fa";

export type ImportTranslationsResult = {
  imported: number;
  skippedMissingKey: number;
};

/**
 * Deterministic FA caption import by canonicalKey → all matching parts.
 * Does not call AI.
 */
export async function importTranslationsForEpisode(
  episodeId: string,
  entries: TranslationEntry[],
  db: DbExecutor = getContentSyncPool(),
): Promise<ImportTranslationsResult> {
  const [partRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(id AS CHAR) AS id, canonical_key AS canonicalKey
    FROM parts
    WHERE episode_id = ?
      AND canonical_key IS NOT NULL
      AND retired_at IS NULL
    `,
    [episodeId],
  );

  const partsByKey = new Map<string, string[]>();
  for (const row of partRows) {
    const key = String(row.canonicalKey);
    const list = partsByKey.get(key) ?? [];
    list.push(String(row.id));
    partsByKey.set(key, list);
  }

  let imported = 0;
  let skippedMissingKey = 0;

  for (const entry of entries) {
    const partIds = partsByKey.get(entry.canonicalKey);
    if (!partIds || partIds.length === 0) {
      skippedMissingKey += 1;
      continue;
    }
    for (const partId of partIds) {
      await db.execute<ResultSetHeader>(
        `
        INSERT INTO caption_translations (
          part_id, language, text, provider, provider_model, created_at
        ) VALUES (?, ?, ?, ?, ?, NOW(3))
        ON DUPLICATE KEY UPDATE
          text = VALUES(text),
          provider = VALUES(provider),
          provider_model = VALUES(provider_model)
        `,
        [
          partId,
          LANGUAGE,
          entry.translation,
          entry.provider,
          entry.providerModel,
        ],
      );
      imported += 1;
    }
  }

  return { imported, skippedMissingKey };
}
