import { getContentSyncPool } from "@/lib/content-sync/syncDb";
import { tableExists } from "@/lib/content-refresh/validateRefresh";
import type { RowDataPacket } from "mysql2/promise";

export type EpisodeImportContext = {
  episodeId: string;
  episodeExists: boolean;
  episodeTitle: string | null;
  partCount: number;
  schema: {
    captionTranslations: boolean;
    partVocabularyOccurrences: boolean;
    partGrammarOccurrences: boolean;
    dictionarySenses: boolean;
    grammarConcepts: boolean;
  };
};

export function mysqlErrorMeta(err: unknown): {
  code?: string;
  errno?: number;
  sqlMessage?: string;
} {
  if (typeof err !== "object" || err === null) return {};
  const row = err as {
    code?: string;
    errno?: number;
    sqlMessage?: string;
  };
  return {
    code: typeof row.code === "string" ? row.code : undefined,
    errno: typeof row.errno === "number" ? row.errno : undefined,
    sqlMessage:
      typeof row.sqlMessage === "string" ? row.sqlMessage : undefined,
  };
}

export function logContentImport(
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
  level: "info" | "error" = "info",
): void {
  const extra = fields ? ` ${JSON.stringify(fields)}` : "";
  const line = `[content-import:${scope}] ${message}${extra}`;
  if (level === "error") console.error(line);
  else console.info(line);
}

/** Episode + schema snapshot for admin import debugging (no secrets). */
export async function getEpisodeImportContext(
  episodeId: string,
): Promise<EpisodeImportContext> {
  const pool = getContentSyncPool();

  const [epRows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT CAST(id AS CHAR) AS id, title
    FROM episodes
    WHERE id = ?
    LIMIT 1
    `,
    [episodeId],
  );

  const [partRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM parts WHERE episode_id = ?`,
    [episodeId],
  );

  const schema = {
    captionTranslations: await tableExists("caption_translations"),
    partVocabularyOccurrences: await tableExists(
      "part_vocabulary_occurrences",
    ),
    partGrammarOccurrences: await tableExists("part_grammar_occurrences"),
    dictionarySenses: await tableExists("dictionary_senses"),
    grammarConcepts: await tableExists("grammar_concepts"),
  };

  return {
    episodeId,
    episodeExists: epRows.length > 0,
    episodeTitle: epRows[0]?.title ? String(epRows[0].title) : null,
    partCount: Number(partRows[0]?.c ?? 0),
    schema,
  };
}
