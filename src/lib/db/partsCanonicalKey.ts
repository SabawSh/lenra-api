/**
 * Pure helpers for parts.canonical_key ↔ Part.canonicalKey mapping.
 * Kept separate so Phase 1 identity rules can be tested without a live DB.
 */

/** Map a SQL `canonical_key` cell to the runtime Part field. */
export function mapCanonicalKeyFromDb(
  value: unknown,
): string | null {
  if (value == null) return null;
  const key = String(value).trim();
  return key.length > 0 ? key : null;
}

/**
 * Whether two runtime parts may legally share the same canonicalKey.
 * Pipeline allows duplicate content identity across distinct part UUIDs.
 */
export function allowDuplicateCanonicalKeys(): true {
  return true;
}

/**
 * Identity layers for Phase 1 — documentation + test anchor.
 *
 * Stable content identity: canonicalKey → parts.canonical_key
 * Database / learner identity: parts.id (UUID) → FKs / progress
 */
export const PART_IDENTITY_LAYERS = {
  content: "canonicalKey",
  database: "id",
} as const;
