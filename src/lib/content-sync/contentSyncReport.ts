import type { ContentSyncPlan, ContentSyncReport } from "./types";
import { summarizeContentSyncPlan } from "./buildContentSyncPlan";

export function formatContentSyncReport(plan: ContentSyncPlan): string {
  const r = summarizeContentSyncPlan(plan);
  const lines = [
    plan.dryRun
      ? "Content synchronization preview (dry-run — no writes)"
      : "Content synchronization report",
    "",
    `Episode: ${r.episodeId}`,
    "",
    `Pipeline clips: ${r.pipelineClipCount}`,
    `Existing active parts: ${r.existingActiveCount}`,
    `Existing parts (incl. retired): ${r.existingPartCount}`,
    "",
    `Matched existing: ${r.matched}`,
    `New parts: ${r.inserted}`,
    `Reordered parts: ${r.reordered}`,
    `Updated content: ${r.updated}`,
    `Restored from retired: ${r.restored}`,
    `Retired parts: ${r.retired}`,
    "",
    `Duplicate canonicalKey groups: ${r.duplicateCanonicalKeyGroups}`,
    `Ambiguous matches: ${r.ambiguousMatches.length}`,
  ];
  if (r.ambiguousMatches.length > 0) {
    lines.push("");
    lines.push("Ambiguities:");
    for (const a of r.ambiguousMatches) {
      lines.push(
        `  - key=${a.canonicalKey} orders=[${a.pipelineOrders.join(",")}] parts=[${a.partIds.join(",")}] (${a.reason})`,
      );
    }
  }
  return lines.join("\n");
}

export function contentSyncReportJson(
  plan: ContentSyncPlan,
): ContentSyncReport {
  return summarizeContentSyncPlan(plan);
}
