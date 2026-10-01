/**
 * Local-only: open every learning batch without sequential completion.
 * Production must stay locked — do not set these env vars on deployed hosts.
 */
export function devUnlockAllLearningBatches(): boolean {
  if (process.env.LENRA_DEV_UNLOCK_ALL_BATCHES === "1") {
    return true;
  }
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === "development" || nodeEnv === "test";
}
