export type AudioBlobMetrics = {
  bytes: number;
  durationMs?: number;
};

/** Best-effort duration + size for STT retry diagnostics. */
export async function measureAudioBlob(
  blob: Blob | null,
): Promise<AudioBlobMetrics> {
  if (!blob) return { bytes: 0 };

  const bytes = blob.size;
  let durationMs: number | undefined;

  if (bytes > 0 && typeof window !== "undefined") {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        durationMs = Math.round(buffer.duration * 1000);
        await ctx.close();
      } catch {
        /* WebM decode may fail — size-only metrics are still useful */
      }
    }
  }

  return { bytes, durationMs };
}
