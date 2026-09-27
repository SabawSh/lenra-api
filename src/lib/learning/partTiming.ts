/** Resolve encoded clip duration for playback timeline (never speech timing). */
export function resolvePlaybackDurationMs(part: {
  playbackDurationMs?: number | null;
  playbackStartMs?: number | null;
  playbackEndMs?: number | null;
}): number {
  if (
    part.playbackDurationMs != null &&
    Number.isFinite(part.playbackDurationMs) &&
    part.playbackDurationMs > 0
  ) {
    return part.playbackDurationMs;
  }
  const start = part.playbackStartMs;
  const end = part.playbackEndMs;
  if (
    start != null &&
    end != null &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
  ) {
    return end - start;
  }
  return 0;
}

/** Spoken content duration for learning engine / analytics (never clip padding). */
export function resolveSpeechDurationMs(part: {
  speechDurationMs?: number | null;
}): number {
  const ms = part.speechDurationMs;
  if (ms != null && Number.isFinite(ms) && ms >= 0) {
    return ms;
  }
  return 0;
}
