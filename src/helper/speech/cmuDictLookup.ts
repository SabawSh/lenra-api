export type CmuDict = Readonly<Record<string, string>>;

let cachedDict: CmuDict | null = null;
let loadPromise: Promise<CmuDict> | null = null;

function stripStress(phone: string): string {
  return phone.replace(/\d/g, "");
}

export function parseArpabet(entry: string): string[] {
  return entry
    .trim()
    .split(/\s+/)
    .map(stripStress)
    .filter(Boolean);
}

export function lookupCmuArpabet(
  dict: CmuDict,
  word: string,
): string[] | null {
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;

  const primary = dict[key];
  if (primary) return parseArpabet(primary);

  for (let index = 2; index <= 6; index++) {
    const alternate = dict[`${key}(${index})`];
    if (alternate) return parseArpabet(alternate);
  }

  return null;
}

/** Lazy-load CMUdict once (Node + browser via dynamic import). */
export async function loadCmuDict(): Promise<CmuDict> {
  if (cachedDict) return cachedDict;
  if (!loadPromise) {
    loadPromise = import("cmu-pronouncing-dictionary-cjs").then((mod) => {
      cachedDict = mod.dictionary as CmuDict;
      return cachedDict;
    });
  }
  return loadPromise;
}

/** Synchronous access after {@link loadCmuDict} has resolved. */
export function getCachedCmuDict(): CmuDict | null {
  return cachedDict;
}

/** Test-only: inject a miniature dictionary without loading the full CMU file. */
export function setCmuDictForTests(dict: CmuDict | null): void {
  cachedDict = dict;
  loadPromise = dict ? Promise.resolve(dict) : null;
}
