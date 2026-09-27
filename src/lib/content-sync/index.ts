import {
  applyContentSyncPlan,
  assertEpisodeExists,
  listPartsForContentSync,
} from "./applyContentSyncPlan";
import { buildContentSyncPlan } from "./buildContentSyncPlan";
import {
  contentSyncReportJson,
  formatContentSyncReport,
} from "./contentSyncReport";
import { loadPipelineClipsFromFile } from "./loadPipelineClips";
import { closeContentSyncPool } from "./syncDb";
import type { ContentSyncPlan, ContentSyncReport, PipelineClip } from "./types";

export type RunContentSyncParams = {
  episodeId: string;
  clipsPath: string;
  dryRun?: boolean;
};

export type RunContentSyncResult = {
  plan: ContentSyncPlan;
  report: ContentSyncReport;
  textReport: string;
};

/**
 * Load → validate → reconcile → (optional) apply content sync for one episode.
 */
export async function runContentSync(
  params: RunContentSyncParams,
): Promise<RunContentSyncResult> {
  const dryRun = params.dryRun === true;
  try {
    await assertEpisodeExists(params.episodeId);

    const document = loadPipelineClipsFromFile(params.clipsPath);
    const existingParts = await listPartsForContentSync(params.episodeId);

    const plan = buildContentSyncPlan({
      episodeId: params.episodeId,
      pipelineClips: document.clips,
      existingParts,
      dryRun,
    });

    if (!dryRun) {
      if (plan.ambiguousMatches.length > 0) {
        throw new Error(
          `Content sync aborted: ${plan.ambiguousMatches.length} ambiguous match(es). Re-run with --dry-run for details.`,
        );
      }
      const clipsByOrder = new Map<number, PipelineClip>();
      for (const clip of document.clips) {
        clipsByOrder.set(clip.order, clip);
      }
      await applyContentSyncPlan(plan, clipsByOrder);
    }

    return {
      plan,
      report: contentSyncReportJson(plan),
      textReport: formatContentSyncReport(plan),
    };
  } finally {
    await closeContentSyncPool();
  }
}

export { buildContentSyncPlan } from "./buildContentSyncPlan";
export {
  loadPipelineClipsFromFile,
  parsePipelineClipsDocument,
} from "./loadPipelineClips";
export {
  formatContentSyncReport,
  contentSyncReportJson,
} from "./contentSyncReport";
export type {
  ContentSyncPlan,
  ContentSyncReport,
  PipelineClip,
  ExistingSyncPart,
} from "./types";
