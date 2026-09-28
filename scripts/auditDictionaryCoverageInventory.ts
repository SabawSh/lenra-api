/**
 * Compare clip lemma inventory against dictionary_entries (read-only).
 *
 *   npx tsx scripts/auditDictionaryCoverageInventory.ts --movie coraline
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadPipelineClipsFromFile,
  parsePipelineClipsDocument,
} from "../src/lib/content-sync/loadPipelineClips";
import { buildClipDictionaryLemmaInventory } from "../src/lib/dictionary/buildClipDictionaryLemmaInventory";
import { pool } from "../src/lib/db/connection";

function parseMovie(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--movie" && argv[i + 1]) {
      return argv[i + 1]!;
    }
  }
  return "coraline";
}

async function main(): Promise<void> {
  const movie = parseMovie(process.argv.slice(2));
  const clipsPath = resolve(
    process.cwd(),
    `../lenra-content-pipeline/output/${movie}/clips.json`,
  );
  const raw = JSON.parse(readFileSync(clipsPath, "utf8"));
  const clips = parsePipelineClipsDocument(raw).clips;
  const inventory = buildClipDictionaryLemmaInventory(clips);

  let alreadyCovered = 0;
  let missingEntries = 0;
  let pendingEntries = 0;
  let existingJobs = 0;

  for (const { lemma } of inventory.eligibleLemmas) {
    const [entryRows] = await pool.execute<
      { id: string; status: string | null; source: string | null }[]
    >(
      `SELECT id, status, source FROM dictionary_entries WHERE lemma = ? AND language = 'en' LIMIT 1`,
      [lemma],
    );
    const entry = entryRows[0];
    if (!entry) {
      missingEntries += 1;
      continue;
    }

    const [senseRows] = await pool.execute<{ c: number }[]>(
      `SELECT COUNT(*) AS c FROM dictionary_senses WHERE dictionary_entry_id = ?`,
      [entry.id],
    );
    const senseCount = Number(senseRows[0]?.c ?? 0);
    const status = entry.status?.trim().toLowerCase();
    const source = entry.source?.trim().toLowerCase();
    const isPending = status === "pending" || source === "pending";

    if (senseCount > 0 && !isPending) {
      alreadyCovered += 1;
    } else {
      pendingEntries += 1;
    }

    const [jobRows] = await pool.execute<{ id: string }[]>(
      `SELECT id FROM dictionary_generation_jobs WHERE lemma = ? AND language = 'en' LIMIT 1`,
      [lemma],
    );
    if (jobRows.length > 0) {
      existingJobs += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        movie,
        totalWordTokenInstances: inventory.totalWordTokenInstances,
        uniqueEligibleLemmas: inventory.eligibleLemmas.length,
        excludedCoreTokenInstances: inventory.excludedCoreLemmaCount,
        alreadyCoveredInDictionaryDb: alreadyCovered,
        missingDictionaryEntries: missingEntries,
        pendingOrEmptyEntries: pendingEntries,
        existingGenerationJobsForEligibleLemmas: existingJobs,
        wouldNeedJobsOnRefresh:
          inventory.eligibleLemmas.length -
          alreadyCovered -
          existingJobs +
          Math.max(0, existingJobs - alreadyCovered),
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
