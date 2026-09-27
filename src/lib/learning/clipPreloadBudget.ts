/**
 * Dual-slot learning player only buffers the immediate next clip — always 1.
 */
export function getClipPreloadAheadCount(): number {
  return 1;
}
