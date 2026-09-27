/**
 * Grammar detail visual resolution for the drawer.
 *
 *   npx tsx lib/learning/grammarVisual.validation.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  grammarDetailVisual,
  grammarVisualUrl,
  TEMPORAL_GRAMMAR_VISUAL_IDS,
} from "./grammarVisual";

const publicGrammar = join(process.cwd(), "public/grammar");

const onDisk = [
  "present_simple",
  "present_continuous",
  "present_perfect",
  "present_perfect_continuous",
  "past_simple",
  "past_continuous",
  "past_perfect",
  "future_will",
  "future_perfect",
] as const;

const approvedWithoutAsset = [
  "future_going_to",
  "future_continuous",
] as const;

for (const id of onDisk) {
  assert.equal(grammarVisualUrl(id), `/grammar/${id}.png`);
  assert.ok(
    existsSync(join(publicGrammar, `${id}.png`)),
    `missing file for ${id}`,
  );
  assert.ok(statSync(join(publicGrammar, `${id}.png`)).size > 0, `${id} empty`);
  const detail = grammarDetailVisual({
    grammarId: id,
    title: id.replaceAll("_", " "),
  });
  assert.ok(detail, `expected visual for ${id}`);
  assert.equal(detail.src, `/grammar/${id}.png`);
  assert.equal(detail.alt, id.replaceAll("_", " "));
}

for (const id of [
  "present_simple",
  "past_continuous",
  "future_will",
  "future_perfect",
] as const) {
  assert.ok(grammarDetailVisual({ grammarId: id, title: "T" }));
}

for (const id of [...approvedWithoutAsset, "passive_voice"] as const) {
  assert.equal(grammarVisualUrl(id), null);
  assert.equal(grammarDetailVisual({ grammarId: id, title: "T" }), null);
}

assert.ok(!existsSync(join(publicGrammar, "future_going_to.png")));
assert.ok(!existsSync(join(publicGrammar, "future_continuous.png")));
assert.ok(!existsSync(join(publicGrammar, "passive_voice.png")));

const a = grammarDetailVisual({ grammarId: "present_simple", title: "A" });
const b = grammarDetailVisual({ grammarId: "past_simple", title: "B" });
const c = grammarDetailVisual({ grammarId: "passive_voice", title: "C" });
assert.notEqual(a?.src, b?.src);
assert.equal(c, null);

assert.equal(TEMPORAL_GRAMMAR_VISUAL_IDS.length, 11);

const pngs = readdirSync(publicGrammar).filter((f) => f.endsWith(".png"));
assert.equal(pngs.length, 9);
assert.deepEqual(
  pngs.sort(),
  onDisk.map((id) => `${id}.png`).sort(),
);

const leftovers = readdirSync(publicGrammar).filter(
  (f) => f.endsWith(".svg") || f.endsWith(".webp"),
);
assert.equal(
  leftovers.length,
  0,
  `unexpected leftover assets: ${leftovers.join(", ")}`,
);

console.log("grammarVisual.validation: ok", {
  onDisk: pngs.length,
  approved: TEMPORAL_GRAMMAR_VISUAL_IDS.length,
  approvedWithoutAsset: approvedWithoutAsset.length,
});
