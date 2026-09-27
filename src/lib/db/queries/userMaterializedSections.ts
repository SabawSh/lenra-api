import { withTransaction, pool } from "@/lib/db/connection";
import type { UserId } from "@/types/schema";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

type SqlScalar = string | number | boolean | Date | bigint | Buffer | null;

export type MaterializedSectionHeader = {
  id: number;
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  scopeKey: string;
  sectionIndex: number;
  curriculumVersion: string;
  globalStartIndex: number | null;
  globalEndIndexExclusive: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MaterializedSectionPartRow = {
  sectionId: number;
  partId: string;
  order: number;
};

export type MaterializedSectionUnitPartRow = {
  sectionId: number;
  unitIndex: number;
  partOrderInUnit: number;
  partId: string;
};

export type MaterializedSectionBlueprint = {
  header: MaterializedSectionHeader;
  atomicParts: MaterializedSectionPartRow[];
  learningUnitParts: MaterializedSectionUnitPartRow[];
  progressionUnitParts: MaterializedSectionUnitPartRow[];
};

export type CreateMaterializedSectionParams = {
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  scopeKey: string;
  sectionIndex: number;
  curriculumVersion: string;
  globalStartIndex: number | null;
  globalEndIndexExclusive: number | null;
  atomicPartIds: string[];
  learningUnitPartIds: string[][];
  progressionUnitPartIds: string[][];
};

function mapHeader(
  row: RowDataPacket & Record<string, unknown>,
): MaterializedSectionHeader {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    videoId: String(row.video_id),
    episodeId: row.episode_id != null ? String(row.episode_id) : null,
    scopeKey: String(row.scope_key),
    sectionIndex: Number(row.section_index),
    curriculumVersion: String(row.curriculum_version),
    globalStartIndex:
      row.global_start_index != null ? Number(row.global_start_index) : null,
    globalEndIndexExclusive:
      row.global_end_index_exclusive != null
        ? Number(row.global_end_index_exclusive)
        : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function duplicateError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

function scopeWhere(scopeKey: string) {
  return {
    clause: "scope_key = ?",
    params: [scopeKey] as SqlScalar[],
  };
}

export async function findMaterializedSectionHeader(params: {
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  scopeKey: string;
  sectionIndex: number;
}): Promise<MaterializedSectionHeader | null> {
  const scope = scopeWhere(params.scopeKey);
  type R = RowDataPacket & Record<string, unknown>;
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(episode_id AS CHAR) AS episode_id,
      scope_key,
      section_index,
      curriculum_version,
      global_start_index,
      global_end_index_exclusive,
      created_at,
      updated_at
    FROM user_materialized_sections
    WHERE user_id = ?
      AND ${scope.clause}
      AND section_index = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [params.userId, ...scope.params, params.sectionIndex],
  );
  const row = rows[0];
  return row ? mapHeader(row) : null;
}

export async function listMaterializedSectionHeaders(params: {
  userId: UserId;
  videoId: string;
  episodeId: string | null;
  scopeKey: string;
}): Promise<MaterializedSectionHeader[]> {
  const scope = scopeWhere(params.scopeKey);
  type R = RowDataPacket & Record<string, unknown>;
  const [rows] = await pool.execute<R[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(episode_id AS CHAR) AS episode_id,
      scope_key,
      section_index,
      curriculum_version,
      global_start_index,
      global_end_index_exclusive,
      created_at,
      updated_at
    FROM user_materialized_sections
    WHERE user_id = ?
      AND ${scope.clause}
    ORDER BY section_index ASC, created_at DESC, id DESC
    `,
    [params.userId, ...scope.params],
  );

  const latestBySection = new Map<number, MaterializedSectionHeader>();
  for (const row of rows) {
    const mapped = mapHeader(row);
    if (!latestBySection.has(mapped.sectionIndex)) {
      latestBySection.set(mapped.sectionIndex, mapped);
    }
  }
  return [...latestBySection.values()].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );
}

/** Atomic part ids for many materialized sections — one query. */
export async function listAtomicPartIdsBySectionIds(
  sectionIds: number[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (sectionIds.length === 0) return out;
  type R = RowDataPacket & {
    section_id: number;
    part_id: string;
    part_order_in_section: number;
  };
  const placeholders = sectionIds.map(() => "?").join(",");
  const [rows] = await pool.execute<R[]>(
    `
    SELECT section_id, CAST(part_id AS CHAR) AS part_id, part_order_in_section
    FROM user_materialized_section_atomic_parts
    WHERE section_id IN (${placeholders})
    ORDER BY section_id ASC, part_order_in_section ASC
    `,
    sectionIds,
  );
  for (const row of rows) {
    const sectionId = Number(row.section_id);
    const list = out.get(sectionId) ?? [];
    list.push(String(row.part_id));
    out.set(sectionId, list);
  }
  return out;
}

export async function loadMaterializedSectionBlueprint(
  sectionId: number,
): Promise<MaterializedSectionBlueprint | null> {
  type RH = RowDataPacket & Record<string, unknown>;
  type RP = RowDataPacket & {
    section_id: number;
    part_id: string;
    part_order_in_section: number;
  };
  type RU = RowDataPacket & {
    section_id: number;
    unit_index: number;
    part_order_in_unit: number;
    part_id: string;
  };

  const [headerRows] = await pool.execute<RH[]>(
    `
    SELECT
      id,
      user_id,
      CAST(video_id AS CHAR) AS video_id,
      CAST(episode_id AS CHAR) AS episode_id,
      scope_key,
      section_index,
      curriculum_version,
      global_start_index,
      global_end_index_exclusive,
      created_at,
      updated_at
    FROM user_materialized_sections
    WHERE id = ?
    LIMIT 1
    `,
    [sectionId],
  );
  const headerRow = headerRows[0];
  if (!headerRow) return null;

  const [atomicRows] = await pool.execute<RP[]>(
    `
    SELECT section_id, CAST(part_id AS CHAR) AS part_id, part_order_in_section
    FROM user_materialized_section_atomic_parts
    WHERE section_id = ?
    ORDER BY part_order_in_section ASC
    `,
    [sectionId],
  );
  const [learningRows] = await pool.execute<RU[]>(
    `
    SELECT section_id, unit_index, part_order_in_unit, CAST(part_id AS CHAR) AS part_id
    FROM user_materialized_section_learning_unit_parts
    WHERE section_id = ?
    ORDER BY unit_index ASC, part_order_in_unit ASC
    `,
    [sectionId],
  );
  const [progressionRows] = await pool.execute<RU[]>(
    `
    SELECT section_id, unit_index, part_order_in_unit, CAST(part_id AS CHAR) AS part_id
    FROM user_materialized_section_progression_unit_parts
    WHERE section_id = ?
    ORDER BY unit_index ASC, part_order_in_unit ASC
    `,
    [sectionId],
  );

  return {
    header: mapHeader(headerRow),
    atomicParts: atomicRows.map((row) => ({
      sectionId: Number(row.section_id),
      partId: String(row.part_id),
      order: Number(row.part_order_in_section),
    })),
    learningUnitParts: learningRows.map((row) => ({
      sectionId: Number(row.section_id),
      unitIndex: Number(row.unit_index),
      partOrderInUnit: Number(row.part_order_in_unit),
      partId: String(row.part_id),
    })),
    progressionUnitParts: progressionRows.map((row) => ({
      sectionId: Number(row.section_id),
      unitIndex: Number(row.unit_index),
      partOrderInUnit: Number(row.part_order_in_unit),
      partId: String(row.part_id),
    })),
  };
}

async function insertAtomicRows(
  conn: PoolConnection,
  sectionId: number,
  partIds: string[],
): Promise<void> {
  if (partIds.length === 0) return;
  await conn.query<ResultSetHeader>(
    `
    INSERT INTO user_materialized_section_atomic_parts (
      section_id,
      part_order_in_section,
      part_id
    ) VALUES ${partIds.map(() => "(?, ?, ?)").join(", ")}
    `,
    partIds.flatMap((partId, index) => [sectionId, index, partId]) as SqlScalar[],
  );
}

async function insertUnitRows(
  conn: PoolConnection,
  table:
    | "user_materialized_section_learning_unit_parts"
    | "user_materialized_section_progression_unit_parts",
  sectionId: number,
  units: string[][],
): Promise<void> {
  const values = units.flatMap((partIds, unitIndex) =>
    partIds.map((partId, partOrderInUnit) => [
      sectionId,
      unitIndex + 1,
      partOrderInUnit,
      partId,
    ]),
  );
  if (values.length === 0) return;
  await conn.query<ResultSetHeader>(
    `
    INSERT INTO ${table} (
      section_id,
      unit_index,
      part_order_in_unit,
      part_id
    ) VALUES ${values.map(() => "(?, ?, ?, ?)").join(", ")}
    `,
    values.flat() as SqlScalar[],
  );
}

export async function createMaterializedSectionBlueprint(
  params: CreateMaterializedSectionParams,
): Promise<MaterializedSectionBlueprint | null> {
  try {
    const sectionId = await withTransaction(async (conn) => {
      const [result] = await conn.execute<ResultSetHeader>(
        `
        INSERT INTO user_materialized_sections (
          user_id,
          video_id,
          episode_id,
          scope_key,
          section_index,
          curriculum_version,
          global_start_index,
          global_end_index_exclusive
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          params.userId,
          params.videoId,
          params.episodeId,
          params.scopeKey,
          params.sectionIndex,
          params.curriculumVersion,
          params.globalStartIndex,
          params.globalEndIndexExclusive,
        ] as SqlScalar[],
      );
      const insertedId = Number(result.insertId);
      await insertAtomicRows(conn, insertedId, params.atomicPartIds);
      await insertUnitRows(
        conn,
        "user_materialized_section_learning_unit_parts",
        insertedId,
        params.learningUnitPartIds,
      );
      await insertUnitRows(
        conn,
        "user_materialized_section_progression_unit_parts",
        insertedId,
        params.progressionUnitPartIds,
      );
      return insertedId;
    });
    return loadMaterializedSectionBlueprint(sectionId);
  } catch (error) {
    if (duplicateError(error)) {
      return null;
    }
    throw error;
  }
}

/** Hard-delete a materialized section header (CASCADE child part rows). */
export async function deleteMaterializedSectionById(
  sectionId: number,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `DELETE FROM user_materialized_sections WHERE id = ?`,
    [sectionId],
  );
}
