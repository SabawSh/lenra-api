import { resolvePlaybackDurationMs } from "@/lib/learning/partTiming";

export type UnitClipSpec = {
  partClipId: string;
  src: string;
  hlsManifestUrl?: string | null;
  durationMs: number;
};

export function unitClipsFromParts(
  parts: ReadonlyArray<{
    id: string;
    videoUrl?: string | null;
    hlsManifestUrl?: string | null;
    playbackDurationMs?: number | null;
    playbackStartMs?: number | null;
    playbackEndMs?: number | null;
  }>,
): UnitClipSpec[] {
  return parts.map((part) => ({
    partClipId: part.id,
    src: part.videoUrl ?? "",
    hlsManifestUrl: part.hlsManifestUrl ?? null,
    durationMs: resolvePlaybackDurationMs(part),
  }));
}

export function unitTimelineOffsetSec(
  clips: readonly UnitClipSpec[],
  clipIndex: number,
): number {
  let ms = 0;
  for (let i = 0; i < clipIndex; i++) {
    ms += clips[i]?.durationMs ?? 0;
  }
  return ms / 1000;
}

export function unitTimelineTotalSec(clips: readonly UnitClipSpec[]): number {
  return clips.reduce((sum, clip) => sum + clip.durationMs, 0) / 1000;
}

/** Map a 0–1 scrub ratio to clip index + local seconds within that clip. */
export function resolveUnitTimelineSeek(
  clips: readonly UnitClipSpec[],
  ratio: number,
): { clipIndex: number; localSec: number } {
  if (clips.length === 0) return { clipIndex: 0, localSec: 0 };

  const totalSec = unitTimelineTotalSec(clips);
  const targetSec = Math.min(Math.max(ratio, 0), 1) * totalSec;
  let accSec = 0;

  for (let i = 0; i < clips.length; i++) {
    const clipSec = clips[i]!.durationMs / 1000;
    const clipEnd = accSec + clipSec;
    if (targetSec <= clipEnd - 0.001 || i === clips.length - 1) {
      return {
        clipIndex: i,
        localSec: Math.max(0, Math.min(targetSec - accSec, clipSec)),
      };
    }
    accSec = clipEnd;
  }

  return { clipIndex: clips.length - 1, localSec: 0 };
}

export function unitClipsKey(clips: readonly UnitClipSpec[]): string {
  return clips.map((clip) => clip.partClipId).join("+");
}
