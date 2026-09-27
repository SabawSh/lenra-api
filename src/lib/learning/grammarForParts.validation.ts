/**
 * Grammar-for-parts grouping + Coraline DB smoke checks.
 *
 *   npm run test:grammar-for-parts
 */
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  extractGrammarPayloadFields,
  groupGrammarByConcept,
  uniquePartIds,
  type GrammarOccurrenceInput,
} from "./grammarForParts";
import { loadGrammarForPartIds } from "./loadGrammarForParts";

const CORALINE_EPISODE = "446df68d-bd18-439b-90ff-d8eb7c5012d2";

function sampleRow(
  overrides: Partial<GrammarOccurrenceInput> &
    Pick<GrammarOccurrenceInput, "occurrenceId" | "partId" | "grammarId">,
): GrammarOccurrenceInput {
  return {
    partOrder: 1,
    partText: "I've never seen that.",
    evidenceSpan: "I've never seen",
    confidence: 0.9,
    source: "pipeline",
    displayNameEn: "Present Perfect",
    displayNameFa: "حال کامل",
    explanationEn: "Links past to present.",
    explanationFa: null,
    category: "verbs",
    subcategory: "tense_and_aspect",
    cefrMin: "B1",
    cefrMax: "C1",
    payload: {
      formation: { en: "have/has + past participle", fa: "have/has + قسمت سوم" },
      usage: { en: "Experience.", fa: "تجربه." },
      examples: [
        { text: "I've already seen it.", translationFa: "قبلاً دیده‌امش." },
      ],
    },
    ...overrides,
  };
}

function testGrouping() {
  const rows: GrammarOccurrenceInput[] = [
    sampleRow({
      occurrenceId: "o1",
      partId: "part-a",
      partOrder: 10,
      grammarId: "present_perfect",
      partText: "I have never seen…",
    }),
    sampleRow({
      occurrenceId: "o2",
      partId: "part-b",
      partOrder: 11,
      grammarId: "present_perfect",
      partText: "She's gone home.",
      displayNameEn: "Present Perfect",
    }),
    sampleRow({
      occurrenceId: "o3",
      partId: "part-a",
      partOrder: 10,
      grammarId: "past_simple",
      displayNameEn: "Past Simple",
      partText: "I saw it yesterday.",
      evidenceSpan: "saw",
      payload: {
        formation: { en: "Verb in the past form" },
      },
      explanationEn: "Completed past actions.",
    }),
  ];

  const grouped = groupGrammarByConcept(rows);
  assert.equal(grouped.length, 2, "two concepts after grouping");

  const pp = grouped.find((g) => g.id === "present_perfect");
  assert.ok(pp);
  assert.equal(pp.occurrenceCount, 2);
  assert.equal(pp.occurrences.length, 2);
  assert.equal(pp.formationEn, "have/has + past participle");
  assert.equal(pp.occurrences[0]!.partId, "part-a");
  assert.equal(pp.occurrences[1]!.partId, "part-b");

  const ps = grouped.find((g) => g.id === "past_simple");
  assert.ok(ps);
  assert.equal(ps.occurrenceCount, 1);
  assert.equal(ps.formationEn, "Verb in the past form");

  assert.equal(grouped[0]!.id, "present_perfect");
}

function testEmpty() {
  assert.deepEqual(groupGrammarByConcept([]), []);
}

function testUniquePartIds() {
  assert.deepEqual(uniquePartIds([" a ", "b", "a", "", "b"]), ["a", "b"]);
}

function testPayloadExtract() {
  const fields = extractGrammarPayloadFields({
    formation: { en: "Subject + V", fa: "فاعل + فعل" },
    usage: { en: "Use it." },
    examples: [{ text: "Hello.", translationFa: "سلام." }, { text: "  " }],
  });
  assert.equal(fields.formationEn, "Subject + V");
  assert.equal(fields.formationFa, "فاعل + فعل");
  assert.equal(fields.catalogExamples.length, 1);
  assert.equal(fields.catalogExamples[0]!.text, "Hello.");
}

async function testCoralineLive() {
  if (!process.env.DATABASE_URL) {
    console.log("grammarForParts: skipped live DB (no DATABASE_URL)");
    return;
  }

  const { closeContentSyncPool, getContentSyncPool } = await import(
    "@/lib/content-sync/syncDb"
  );
  const pool = getContentSyncPool();

  try {
    const [partRows] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT DISTINCT CAST(p.id AS CHAR) AS id
      FROM parts p
      INNER JOIN part_grammar_occurrences pgo ON pgo.part_id = p.id
      WHERE p.episode_id = ?
      LIMIT 3
      `,
      [CORALINE_EPISODE],
    );

    if (partRows.length === 0) {
      console.log(
        "grammarForParts: skipped Coraline live (no grammar-linked parts)",
      );
      return;
    }

    const ids = partRows.map((r) => String(r.id));
    const result = await loadGrammarForPartIds(ids, pool);
    assert.ok(result.grammar.length >= 1, "expected at least one concept");
    for (const g of result.grammar) {
      // Learner-facing loader must never return demoted catalog ids.
      assert.notEqual(g.id, "subordinate_clause");
      assert.notEqual(g.id, "negation");
    }

    const allOccPartIds = new Set(
      result.grammar.flatMap((g) => g.occurrences.map((o) => o.partId)),
    );
    for (const id of allOccPartIds) {
      assert.ok(ids.includes(id), `occurrence part ${id} not in request`);
    }

    const merged = await loadGrammarForPartIds(ids, pool);
    const conceptIds = merged.grammar.map((g) => g.id);
    assert.equal(
      conceptIds.length,
      new Set(conceptIds).size,
      "concepts must be unique after merge",
    );

    const empty = await loadGrammarForPartIds(
      ["00000000-0000-0000-0000-000000000099"],
      pool,
    );
    assert.deepEqual(empty.grammar, []);

    console.log(
      `grammarForParts: Coraline sample concepts → ${merged.grammar
        .map((g) => `${g.id}×${g.occurrenceCount}`)
        .join(", ")}`,
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT"
    ) {
      console.log(
        `grammarForParts: skipped live DB (${code} — MySQL unavailable)`,
      );
      return;
    }
    throw err;
  } finally {
    await closeContentSyncPool().catch(() => undefined);
  }
}

async function main() {
  testGrouping();
  testEmpty();
  testUniquePartIds();
  testPayloadExtract();
  await testCoralineLive();
  console.log("grammarForParts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
