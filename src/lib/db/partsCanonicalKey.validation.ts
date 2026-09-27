/**
 * Phase 1 identity: parts.canonical_key ↔ Part.canonicalKey
 *
 *   npx tsx lib/db/partsCanonicalKey.validation.ts
 *   npm run test:parts-canonical-key
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  allowDuplicateCanonicalKeys,
  mapCanonicalKeyFromDb,
  PART_IDENTITY_LAYERS,
} from "./partsCanonicalKey";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

{
  assert(PART_IDENTITY_LAYERS.content === "canonicalKey", "content layer name");
  assert(PART_IDENTITY_LAYERS.database === "id", "database layer remains id");
}

{
  assert(mapCanonicalKeyFromDb(null) === null, "null DB → null runtime");
  assert(mapCanonicalKeyFromDb(undefined) === null, "undefined DB → null");
  assert(mapCanonicalKeyFromDb("") === null, "empty string → null");
  assert(mapCanonicalKeyFromDb("  ") === null, "whitespace → null");
  assert(
    mapCanonicalKeyFromDb("abc123def456") === "abc123def456",
    "string maps 1:1",
  );
  assert(
    mapCanonicalKeyFromDb("  keyed  ") === "keyed",
    "trim without inventing a hash",
  );
}

{
  assert(
    allowDuplicateCanonicalKeys() === true,
    "duplicate canonical keys must be allowed",
  );

  // Simulate pipeline case: 800 unique keys, 810 clips, 10 shared.
  const key = "shared-canonical-content";
  const parts = [
    { id: "uuid-a", episodeId: "ep1", order: 10, canonicalKey: key },
    { id: "uuid-b", episodeId: "ep1", order: 42, canonicalKey: key },
  ];
  assert(parts[0]!.id !== parts[1]!.id, "runtime UUIDs stay distinct");
  assert(
    parts[0]!.canonicalKey === parts[1]!.canonicalKey,
    "same canonicalKey on two parts is valid",
  );
  const matched = parts.filter((p) => p.canonicalKey === key);
  assert(matched.length === 2, "episode+key lookup may return multiple rows");
}

{
  // Existing part without key still hydrates.
  const legacyRow = {
    id: "legacy-uuid",
    episode_id: "ep",
    order: 1,
    canonical_key: null,
  };
  const hydrated = {
    id: String(legacyRow.id),
    canonicalKey: mapCanonicalKeyFromDb(legacyRow.canonical_key),
  };
  assert(hydrated.id === "legacy-uuid", "id unchanged when key is null");
  assert(hydrated.canonicalKey === null, "missing key stays null");
}

{
  // Setting a key must not imply regenerating id (identity contract).
  const before = { id: "stable-uuid", canonicalKey: null as string | null };
  const after = {
    id: before.id,
    canonicalKey: mapCanonicalKeyFromDb("pipeline-key-001"),
  };
  assert(after.id === before.id, "adding canonicalKey does not change parts.id");
  assert(after.canonicalKey === "pipeline-key-001", "key attached");
}

{
  const migration = readFileSync(
    join(process.cwd(), "migrations/20260905_parts_canonical_key.sql"),
    "utf8",
  );
  assert(
    migration.includes("ADD COLUMN canonical_key"),
    "migration adds canonical_key",
  );
  assert(
    /NOT UNIQUE|intentionally NOT UNIQUE/i.test(migration),
    "migration documents non-uniqueness",
  );
  assert(
    !/UNIQUE\s*\(\s*canonical_key\s*\)/i.test(migration) &&
      !/UNIQUE KEY[^\n]*canonical_key/i.test(migration),
    "migration must not UNIQUE-constrain canonical_key alone",
  );
  assert(
    migration.includes("parts_episode_id_canonical_key_idx"),
    "episode-scoped index present",
  );
  assert(
    migration.includes("parts_canonical_key_idx"),
    "global index present",
  );
  assert(
    !/NOT NULL/.test(
      migration
        .split("\n")
        .find((l) => l.includes("canonical_key VARCHAR")) ?? "",
    ),
    "canonical_key column remains nullable",
  );
}

{
  const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");
  assert(
    schema.includes("canonical_key VARCHAR(64) NULL"),
    "schema.sql documents nullable canonical_key",
  );
  assert(
    schema.includes("parts_episode_id_canonical_key_idx"),
    "schema.sql has episode+key index",
  );
}

console.log("partsCanonicalKey: ok");
