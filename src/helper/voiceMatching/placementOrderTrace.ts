/**
 * Placement-order probe — debug-gated.
 * Enable: NEXT_PUBLIC_STT_DEBUG=1 | NEXT_PUBLIC_STT_FALLBACK_DEBUG=1 | VOICE_MATCH_DEBUG=1
 */
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";

export function placementOrderTraceEnabled(): boolean {
  return (
    resolveSttFallbackConfig().debug ||
    process.env.NEXT_PUBLIC_STT_FALLBACK_DEBUG === "1" ||
    process.env.VOICE_MATCH_DEBUG === "1"
  );
}

export function logPlacementOrder(lines: readonly string[]): void {
  if (!placementOrderTraceEnabled()) return;
  // eslint-disable-next-line no-console -- intentional placement-order probe
  console.log(["====================================================", ...lines, "===================================================="].join("\n"));
}
