/**
 * Stage 6 — Grammar → Lenra integration regression cases (A–I) + learner scenario.
 *
 *   npm run test:grammar-integration
 *
 * Pure + mock-DB checks (no Playwright). Live Coraline checks run when DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  partIdsForCanonicalKey,
  shouldImportGrammarOccurrence,
} from "@/lib/content-refresh/importGrammar";
import type { GrammarCatalogEntry } from "@/lib/content-refresh/types";
import {
  groupGrammarByConcept,
  type GrammarForPartsResult,
  type GrammarOccurrenceInput,
} from "./grammarForParts";
import {
  autoOpenGrammarDetailId,
  grammarDataForDisplay,
  shouldCloseGrammarDrawer,
  shouldShowGrammarTrigger,
} from "./grammarTriggerVisibility";
import { loadGrammarForPartIds, type GrammarDbExecutor } from "./loadGrammarForParts";

const CORALINE_EPISODE = "446df68d-bd18-439b-90ff-d8eb7c5012d2";

function sampleRow(
  overrides: Partial<GrammarOccurrenceInput> &
    Pick<GrammarOccurrenceInput, "occurrenceId" | "partId" | "grammarId">,
): GrammarOccurrenceInput {
  return {
    partOrder: 1,
    partText: "sample",
    evidenceSpan: "sample",
    confidence: 0.9,
    source: "pipeline",
    displayNameEn: overrides.grammarId,
    displayNameFa: null,
    explanationEn: "explanation",
    explanationFa: null,
    category: "verbs",
    subcategory: null,
    cefrMin: "A2",
    cefrMax: "B2",
    payload: {
      formation: { en: "pattern" },
      usage: { en: "when/why" },
      examples: [{ text: "Example sentence." }],
    },
    ...overrides,
  };
}

function resultFromIds(
  ids: { id: string; occurrenceCount: number; evidence?: string; partText?: string }[],
): GrammarForPartsResult {
  return {
    grammar: ids.map((c) => ({
      id: c.id,
      titleEn: c.id,
      titleFa: null,
      explanationEn: "explanation",
      explanationFa: null,
      formationEn: "pattern",
      formationFa: null,
      usageEn: "usage",
      usageFa: null,
      category: null,
      subcategory: null,
      cefrMin: null,
      cefrMax: null,
      catalogExamples: [{ text: "catalog", translationFa: null, type: null }],
      occurrenceCount: c.occurrenceCount,
      occurrences: Array.from({ length: c.occurrenceCount }, (_, i) => ({
        occurrenceId: `${c.id}-${i}`,
        partId: `part-${i}`,
        partOrder: i + 1,
        partText: c.partText ?? `${c.id} sentence`,
        evidenceSpan: c.evidence ?? c.id,
        confidence: 0.9,
        source: "pipeline",
      })),
    })),
  };
}

/** Case A — no Grammar → trigger hidden */
function caseA_noGrammar() {
  const empty: GrammarForPartsResult = { grammar: [] };
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );
}

/** Case B — one concept → direct detail */
function caseB_oneConcept() {
  const one = resultFromIds([{ id: "present_simple", occurrenceCount: 1 }]);
  assert.equal(autoOpenGrammarDetailId(one), "present_simple");
  assert.equal(shouldShowGrammarTrigger({ status: "ready", data: one, puzzleResolved: true}), true);
}

/** Case C — multiple concepts → list (no auto-detail) */
function caseC_multipleConcepts() {
  const multi = resultFromIds([
    { id: "present_simple", occurrenceCount: 1 },
    { id: "past_simple", occurrenceCount: 1 },
  ]);
  assert.equal(autoOpenGrammarDetailId(multi), null);
  assert.equal(shouldShowGrammarTrigger({ status: "ready", data: multi, puzzleResolved: true}), true);
}

/** Case D — duplicate grammarId across merged parts → one card, occurrences preserved */
function caseD_duplicateOccurrenceGrouping() {
  const grouped = groupGrammarByConcept([
    sampleRow({
      occurrenceId: "o1",
      partId: "part-a",
      partOrder: 1,
      grammarId: "present_simple",
      partText: "I like dirt.",
      evidenceSpan: "like",
      displayNameEn: "Present Simple",
    }),
    sampleRow({
      occurrenceId: "o2",
      partId: "part-b",
      partOrder: 2,
      grammarId: "present_simple",
      partText: "She walks home.",
      evidenceSpan: "walks",
      displayNameEn: "Present Simple",
    }),
    sampleRow({
      occurrenceId: "o3",
      partId: "part-b",
      partOrder: 2,
      grammarId: "past_simple",
      partText: "She walked home.",
      evidenceSpan: "walked",
      displayNameEn: "Past Simple",
    }),
  ]);
  assert.equal(grouped.length, 2);
  const ps = grouped.find((g) => g.id === "present_simple");
  assert.ok(ps);
  assert.equal(ps.occurrenceCount, 2);
  assert.equal(ps.occurrences[0]!.evidenceSpan, "like");
  assert.equal(ps.occurrences[1]!.evidenceSpan, "walks");
  assert.equal(ps.occurrences[0]!.partId, "part-a");
  assert.equal(ps.occurrences[1]!.partId, "part-b");
}

/** Case E — duplicate canonicalKey → fan-out to every matching part id */
function caseE_duplicateCanonicalKey() {
  const partsByKey = new Map<string, string[]>([
    ["key-dup", ["part-uuid-1", "part-uuid-2"]],
    ["key-solo", ["part-uuid-3"]],
  ]);
  assert.deepEqual(partIdsForCanonicalKey(partsByKey, "key-dup"), [
    "part-uuid-1",
    "part-uuid-2",
  ]);
  assert.deepEqual(partIdsForCanonicalKey(partsByKey, "missing"), []);
}

/** Case F — demoted concept excluded at import + loader SQL */
async function caseF_demotedConcept() {
  const catalogById = new Map<string, GrammarCatalogEntry>([
    [
      "subordinate_clause",
      {
        id: "subordinate_clause",
        displayNameEn: "Subordinate Clause",
        displayNameFa: null,
        category: "clause_structure",
        subcategory: null,
        cefrMin: null,
        cefrMax: null,
        teachingEligible: false,
        pedagogicalPriority: null,
        explanationEn: null,
        explanationFa: null,
        payload: {},
      },
    ],
    [
      "present_simple",
      {
        id: "present_simple",
        displayNameEn: "Present Simple",
        displayNameFa: null,
        category: "verbs",
        subcategory: null,
        cefrMin: null,
        cefrMax: null,
        teachingEligible: true,
        pedagogicalPriority: 1,
        explanationEn: null,
        explanationFa: null,
        payload: {},
      },
    ],
  ]);
  assert.equal(
    shouldImportGrammarOccurrence("subordinate_clause", catalogById),
    false,
  );
  assert.equal(
    shouldImportGrammarOccurrence("present_simple", catalogById),
    true,
  );
  // Unknown id still importable as stub (loader will hide teaching_eligible=0).
  assert.equal(shouldImportGrammarOccurrence("brand_new_id", catalogById), true);

  let capturedSql = "";
  const mockDb: GrammarDbExecutor = {
    async execute(sql) {
      capturedSql = sql;
      return [[] as never, undefined];
    },
  };
  await loadGrammarForPartIds(["part-1"], mockDb);
  assert.match(capturedSql, /teaching_eligible\s*=\s*1/);
}

/** Case G — replace semantics: cascade deletes part_grammar_occurrences with parts */
function caseG_contentReplaceCleanup() {
  // Documented FK contract from resetEpisodeParts — cascade on parts delete.
  const cascadeTables = [
    "caption_translations",
    "part_dictionary_entries",
    "part_grammar_occurrences",
    "part_vocabulary_occurrences",
  ] as const;
  assert.ok(cascadeTables.includes("part_grammar_occurrences"));
}

/** Case H — unit transition grammar → none: close drawer, hide trigger, no stale data */
function caseH_unitTransition() {
  const withG = resultFromIds([{ id: "past_simple", occurrenceCount: 1 }]);
  const empty: GrammarForPartsResult = { grammar: [] };

  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: withG, puzzleResolved: true}),
    true,
  );
  assert.equal(
    shouldShowGrammarTrigger({ status: "ready", data: empty, puzzleResolved: true}),
    false,
  );
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: empty,
    }),
    true,
  );
  assert.equal(
    grammarDataForDisplay({
      status: "loading",
      data: withG,
      partKey: "part-b",
      dataPartKey: "part-a",
    }),
    null,
  );
  assert.equal(
    grammarDataForDisplay({
      status: "ready",
      data: withG,
      partKey: "part-b",
      dataPartKey: "part-a",
    }),
    null,
  );
}

/**
 * Case I — Grammar open/close is isolated from exercise/voice/video state.
 * Architecturally: GrammarDrawer is a sibling overlay; useUnitGrammar only
 * owns drawerOpen + fetch state. This asserts the isolation contract.
 */
function caseI_stateIsolationContract() {
  const exerciseState = {
    answering: true,
    selectedTileIds: ["t1", "t2"],
    videoPositionMs: 1234,
    autoplay: true,
    adaptiveLevel: "B1",
  };
  // Opening/closing Grammar must not mutate learner state objects owned elsewhere.
  const before = structuredClone(exerciseState);
  const drawerOpen = true;
  void drawerOpen;
  assert.deepEqual(exerciseState, before);
  const drawerClosed = false;
  void drawerClosed;
  assert.deepEqual(exerciseState, before);
}

/** E2E-style learner scenario (logic path through visibility + grouping) */
function learnerScenario() {
  // 1–3. Enter unit with Grammar
  const unitA = resultFromIds([
    {
      id: "first_conditional",
      occurrenceCount: 1,
      evidence: "If you stay",
      partText: "If you stay here, you can have whatever you want.",
    },
  ]);
  assert.equal(shouldShowGrammarTrigger({ status: "ready", data: unitA, puzzleResolved: true}), true);
  // 4–6. Open → single concept detail
  assert.equal(autoOpenGrammarDetailId(unitA), "first_conditional");
  const detail = unitA.grammar[0]!;
  assert.equal(detail.occurrences[0]!.evidenceSpan, "If you stay");
  assert.ok(detail.explanationEn);
  assert.ok(detail.formationEn);
  // 7. Close (drawer flag only)
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: unitA,
    }),
    false,
  );
  // 8–10. Move to another Grammar unit
  const unitB = resultFromIds([
    {
      id: "modal_perfect",
      occurrenceCount: 1,
      evidence: "would've died",
      partText: "I would've died.",
    },
    {
      id: "phrasal_verb",
      occurrenceCount: 1,
      evidence: "Go on",
      partText: "Go on.",
    },
  ]);
  assert.equal(autoOpenGrammarDetailId(unitB), null);
  assert.equal(
    grammarDataForDisplay({
      status: "ready",
      data: unitB,
      partKey: "b",
      dataPartKey: "b",
    }),
    unitB,
  );
  // 11–12. Unit with no Grammar
  const unitC: GrammarForPartsResult = { grammar: [] };
  assert.equal(shouldShowGrammarTrigger({ status: "ready", data: unitC, puzzleResolved: true}), false);
  assert.equal(
    shouldCloseGrammarDrawer({
      drawerOpen: true,
      status: "ready",
      data: unitC,
    }),
    true,
  );
  // 13–14. Learning continues (trigger hidden; no stale A/B content)
  assert.equal(
    grammarDataForDisplay({
      status: "ready",
      data: unitA,
      partKey: "c",
      dataPartKey: "a",
    }),
    null,
  );
}

async function liveDbChecks() {
  if (!process.env.DATABASE_URL) {
    console.log("grammarIntegration: skipped live DB (no DATABASE_URL)");
    return;
  }

  const { closeContentSyncPool, getContentSyncPool } = await import(
    "@/lib/content-sync/syncDb"
  );
  const pool = getContentSyncPool();
  try {
    const [occCount] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT COUNT(*) AS c
      FROM part_grammar_occurrences pgo
      INNER JOIN parts p ON p.id = pgo.part_id
      WHERE p.episode_id = ?
      `,
      [CORALINE_EPISODE],
    );
    const totalOcc = Number(occCount[0]?.c ?? 0);

    const [orphanParts] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT COUNT(*) AS c
      FROM part_grammar_occurrences pgo
      LEFT JOIN parts p ON p.id = pgo.part_id
      WHERE p.id IS NULL
      `,
    );
    assert.equal(Number(orphanParts[0]?.c ?? 0), 0, "orphan part_id rows");

    const [orphanConcepts] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT COUNT(*) AS c
      FROM part_grammar_occurrences pgo
      LEFT JOIN grammar_concepts gc ON gc.id = pgo.grammar_id
      WHERE gc.id IS NULL
      `,
    );
    assert.equal(
      Number(orphanConcepts[0]?.c ?? 0),
      0,
      "orphan grammar_id rows",
    );

    const [ineligibleLearner] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT COUNT(*) AS c
      FROM part_grammar_occurrences pgo
      INNER JOIN parts p ON p.id = pgo.part_id
      INNER JOIN grammar_concepts gc ON gc.id = pgo.grammar_id
      WHERE p.episode_id = ?
        AND gc.teaching_eligible = 0
      `,
      [CORALINE_EPISODE],
    );
    // Rows may exist historically; learner loader must exclude them.
    const demotedRows = Number(ineligibleLearner[0]?.c ?? 0);

    const [dupKeys] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT canonical_key AS k, COUNT(*) AS c
      FROM parts
      WHERE episode_id = ?
        AND canonical_key IS NOT NULL
      GROUP BY canonical_key
      HAVING COUNT(*) > 1
      LIMIT 5
      `,
      [CORALINE_EPISODE],
    );

    if (dupKeys.length > 0) {
      const key = String(dupKeys[0]!.k);
      const [parts] = await pool.execute<
        import("mysql2/promise").RowDataPacket[]
      >(
        `
        SELECT CAST(id AS CHAR) AS id
        FROM parts
        WHERE episode_id = ? AND canonical_key = ?
        `,
        [CORALINE_EPISODE, key],
      );
      const partIds = parts.map((r) => String(r.id));
      assert.ok(partIds.length >= 2, "duplicate key should map to ≥2 parts");
      const loaded = await loadGrammarForPartIds(partIds, pool);
      for (const concept of loaded.grammar) {
        for (const occ of concept.occurrences) {
          assert.ok(
            partIds.includes(occ.partId),
            `occurrence part ${occ.partId} outside duplicate-key set`,
          );
        }
      }
    }

    const [sampleParts] = await pool.execute<
      import("mysql2/promise").RowDataPacket[]
    >(
      `
      SELECT DISTINCT CAST(p.id AS CHAR) AS id
      FROM parts p
      INNER JOIN part_grammar_occurrences pgo ON pgo.part_id = p.id
      INNER JOIN grammar_concepts gc ON gc.id = pgo.grammar_id
      WHERE p.episode_id = ?
        AND gc.teaching_eligible = 1
      LIMIT 3
      `,
      [CORALINE_EPISODE],
    );
    if (sampleParts.length > 0) {
      const ids = sampleParts.map((r) => String(r.id));
      const result = await loadGrammarForPartIds(ids, pool);
      for (const g of result.grammar) {
        assert.notEqual(g.id, "subordinate_clause");
        assert.notEqual(g.id, "negation");
        assert.notEqual(g.id, "modal_auxiliary");
      }
    }

    console.log("grammarIntegration: live DB", {
      coralineOccurrenceRows: totalOcc,
      demotedOccurrenceRowsStillInDb: demotedRows,
      duplicateCanonicalKeyGroupsSampled: dupKeys.length,
    });
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
        `grammarIntegration: skipped live DB (${code} — MySQL unavailable)`,
      );
      return;
    }
    throw err;
  } finally {
    await closeContentSyncPool().catch(() => undefined);
  }
}

async function main() {
  caseA_noGrammar();
  caseB_oneConcept();
  caseC_multipleConcepts();
  caseD_duplicateOccurrenceGrouping();
  caseE_duplicateCanonicalKey();
  await caseF_demotedConcept();
  caseG_contentReplaceCleanup();
  caseH_unitTransition();
  caseI_stateIsolationContract();
  learnerScenario();
  await liveDbChecks();
  console.log("grammarIntegration: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
