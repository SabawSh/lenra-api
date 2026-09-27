/** FNV-1a 32-bit — stable across server and client for the same string. */
export function hashSeedString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (Math.imul(t ^ (t >>> 7), 61 | t) ^ t) >>> 0;
    return (t ^ (t >>> 14)) / 4294967296;
  };
}

/** Fisher–Yates order via seeded sort keys — identical on SSR and hydration. */
export function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  if (arr.length <= 1) return [...arr];
  const rng = mulberry32(hashSeedString(seed));
  return [...arr]
    .map((v) => ({ v, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ v }) => v);
}
