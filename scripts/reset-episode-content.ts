/**
 * Safe test-episode content reset (parts + attachments). Episode row is kept.
 *
 *   npx tsx scripts/reset-episode-content.ts --episode <uuid> --dry-run
 *   npx tsx scripts/reset-episode-content.ts --episode <uuid> --apply
 */
import "dotenv/config";

import {
  applyTestEpisodeContentReset,
  EpisodeContentResetBlockedError,
  previewTestEpisodeContentReset,
} from "../src/lib/content-refresh/safeTestEpisodeContentReset";

function usage(): never {
  console.error(`Usage:
  npx tsx scripts/reset-episode-content.ts --episode <uuid> --dry-run
  npx tsx scripts/reset-episode-content.ts --episode <uuid> --apply`);
  process.exit(1);
}

function parseArgs(argv: string[]): { episodeId: string; apply: boolean } {
  let episodeId = "";
  let apply = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--episode" && argv[i + 1]) {
      episodeId = argv[i + 1]!.trim();
      i += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
  }

  if (!episodeId) usage();
  if (apply && dryRun) {
    console.error("ERROR: use either --dry-run or --apply, not both");
    process.exit(1);
  }
  if (!apply && !dryRun) {
    dryRun = true;
  }

  return { episodeId, apply };
}

function printPreview(preview: Awaited<ReturnType<typeof previewTestEpisodeContentReset>>) {
  console.log("=== Episode content reset (dry-run) ===");
  console.log(JSON.stringify(preview.context, null, 2));
  console.log("\nRelated record counts:");
  console.log(JSON.stringify(preview.counts, null, 2));
  if (preview.learnerProgressBlockers.length > 0) {
    console.log("\nBLOCKED — learner progress:");
    for (const line of preview.learnerProgressBlockers) {
      console.log(`  - ${line}`);
    }
  } else {
    console.log("\nOK — no learner progress blockers.");
  }
  console.log("\nNotes:");
  for (const note of preview.notes) {
    console.log(`  - ${note}`);
  }
}

async function main(): Promise<void> {
  const { episodeId, apply } = parseArgs(process.argv.slice(2));

  if (!apply) {
    const preview = await previewTestEpisodeContentReset(episodeId);
    printPreview(preview);
    process.exit(preview.allowed ? 0 : 2);
  }

  try {
    const result = await applyTestEpisodeContentReset(episodeId);
    console.log("=== Episode content reset applied ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof EpisodeContentResetBlockedError) {
      printPreview(error.preview);
      process.exit(2);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
