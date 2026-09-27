/** Stable pseudo-random number from a string id (for display fallbacks). */
export function deterministicNum(
  id: string,
  min: number,
  max: number,
): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash = hash & hash;
  }
  return min + (Math.abs(hash) % (max - min + 1));
}
