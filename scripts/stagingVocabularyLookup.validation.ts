/**
 * Staging vocabulary fixture integration (hello__greeting).
 * Requires local lenra-api + staging DB with imported Analytics Demo content.
 *
 *   npx tsx scripts/stagingVocabularyLookup.validation.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const { lookupDictionaryEntryBySenseId } = await import(
  "../src/lib/db/queries/dictionary.ts"
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SENSE_ID = "hello__greeting";

const result = await lookupDictionaryEntryBySenseId(SENSE_ID, {
  displayWord: "Hello",
});

console.log(
  JSON.stringify(
    {
      id: result.id,
      lemma: result.lemma,
      status: result.status,
      senseCount: result.senses.length,
      firstSense: result.senses[0]
        ? {
            id: result.senses[0].id,
            definitionEn: result.senses[0].definitionEn,
            definitionFa: result.senses[0].definitionFa,
            partOfSpeech: result.senses[0].partOfSpeech,
          }
        : null,
    },
    null,
    2,
  ),
);

assert(result.status === "ready", `expected ready, got ${result.status}`);
assert(result.senses.length > 0, "expected at least one sense");
assert(
  result.senses.some((s) => s.id === SENSE_ID || Boolean(s.definitionEn)),
  "expected hello sense content visible",
);
assert(
  Boolean(
    result.senses[0]?.definitionEn?.trim() ||
      result.senses[0]?.definitionFa?.trim(),
  ),
  "definition must be visible (do not fabricate empty ready)",
);

console.log("stagingVocabularyLookup.validation: PASS");
