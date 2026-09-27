/**
 * SQL fragments for the canonical `part_catalog` view
 * (part → episode → season → video).
 *
 * View id columns use utf8mb4_unicode_ci (see migrations/20250528_part_catalog_collation.sql).
 */
const UC = "utf8mb4_unicode_ci";

/** Join when the non-catalog side is a table VARCHAR id. */
function joinCatalogPartId(catalogAlias: string, tableCol: string): string {
  return `${catalogAlias}.part_id COLLATE ${UC} = ${tableCol}`;
}

/** Join progress rows to catalog metadata (requires alias `upp` on user_part_progress). */
export const USER_PROGRESS_JOIN_PART_CATALOG = `
  INNER JOIN part_catalog pc ON ${joinCatalogPartId("pc", "upp.part_id")}
`;

/** Join a parts row to catalog metadata (requires alias `p` on parts). */
export const PART_JOIN_PART_CATALOG = `
  INNER JOIN part_catalog pc ON ${joinCatalogPartId("pc", "p.id")}
`;

/** Join saved vocabulary clip to catalog (requires alias `svc` and `p` on parts). */
export const VOCAB_CLIP_JOIN_PART_CATALOG = `
  INNER JOIN parts p ON p.id = svc.clip_id
  INNER JOIN part_catalog pc ON ${joinCatalogPartId("pc", "p.id")}
`;

/** Join catalog video/episode ids to table PKs (continue-learning style queries). */
export const JOIN_EPISODE_ON_CATALOG = (pcAlias: string, eAlias: string) =>
  `${eAlias}.id = ${pcAlias}.episode_id COLLATE ${UC}`;

export const JOIN_VIDEO_ON_CATALOG = (pcAlias: string, vAlias: string) =>
  `${vAlias}.id = ${pcAlias}.video_id COLLATE ${UC}`;
