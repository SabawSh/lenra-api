/**
 * Regression: empty hydrate must not claim a huge atomicPartCount
 * (stale cached part UUIDs after content rebuild → Learn 404).
 *
 *   npm run test:stale-part-order-playlist
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { writeFileSync } from "fs";
import { join } from "path";
import assert from "node:assert/strict";

const serverOnlyPath = join(process.cwd(), "node_modules/server-only/index.js");
const original = `throw new Error(
  "This module cannot be imported from a Client Component module. " +
    "It should only be used from a Server Component."
);
`;
writeFileSync(serverOnlyPath, "module.exports={};\n");

async function main() {
  try {
    const { buildVisibleSectionPlaylistFromPool } = await import(
      "./buildVisibleSectionPlaylist"
    );
    const { VISIBLE_UNITS_PER_SECTION } = await import("./sections");
    type Part = {
      id: string;
      order: number;
      difficultyScore: number | null;
      wordCount: number;
      speechDurationMs: number;
    };

    function fakePart(id: string, order: number): Part {
      return {
        id,
        order,
        difficultyScore: 1,
        wordCount: 4,
        speechDurationMs: 1200,
      };
    }

    const empty = await buildVisibleSectionPlaylistFromPool([], 0, null);
    assert.equal(empty.learningUnits.length, 0);
    assert.equal(empty.atomicPartCount, 0);
    assert.notEqual(empty.atomicPartCount, 794);

    const live = Array.from({ length: 40 }, (_, i) =>
      fakePart(`live-${i + 1}`, i + 1),
    );
    const ok = await buildVisibleSectionPlaylistFromPool(live, 0, null);
    assert.ok(ok.learningUnits.length >= 1);
    assert.ok(ok.atomicPartCount > 0);
    assert.ok(ok.learningUnits.length <= VISIBLE_UNITS_PER_SECTION);

    console.log("stale-part-order-playlist: ok", {
      liveUnits: ok.learningUnits.length,
      liveAtomic: ok.atomicPartCount,
    });
  } finally {
    writeFileSync(serverOnlyPath, original);
  }
}

main().catch((e) => {
  writeFileSync(serverOnlyPath, original);
  console.error(e);
  process.exit(1);
});
