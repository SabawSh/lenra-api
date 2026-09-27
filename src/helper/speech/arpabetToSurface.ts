/**
 * Align tile orthography to a CMUdict ARPAbet pronunciation and emit the
 * grapheme sequence STT is likely to produce (silent letters omitted).
 *
 * Uses one static phone→grapheme correspondence table — not per-word rules.
 */

type GraphemeCandidate = {
  pattern: string;
  surface: string;
};

const PHONE_GRAPHEMES: Record<string, readonly GraphemeCandidate[]> = {
  AA: [{ pattern: "a", surface: "a" }, { pattern: "o", surface: "o" }],
  AE: [{ pattern: "a", surface: "a" }],
  AH: [{ pattern: "a", surface: "a" }, { pattern: "u", surface: "u" }, { pattern: "o", surface: "o" }, { pattern: "e", surface: "e" }],
  AO: [{ pattern: "aw", surface: "aw" }, { pattern: "au", surface: "au" }, { pattern: "o", surface: "o" }],
  AW: [{ pattern: "ou", surface: "ou" }, { pattern: "ow", surface: "ow" }],
  AY: [{ pattern: "igh", surface: "igh" }, { pattern: "ye", surface: "ye" }, { pattern: "ie", surface: "ie" }, { pattern: "i", surface: "i" }, { pattern: "y", surface: "y" }],
  B: [{ pattern: "bb", surface: "b" }, { pattern: "b", surface: "b" }],
  CH: [{ pattern: "tch", surface: "tch" }, { pattern: "ch", surface: "ch" }],
  D: [{ pattern: "dd", surface: "d" }, { pattern: "d", surface: "d" }],
  DH: [{ pattern: "th", surface: "th" }],
  EH: [{ pattern: "ea", surface: "ea" }, { pattern: "e", surface: "e" }],
  ER: [{ pattern: "ear", surface: "ear" }, { pattern: "er", surface: "er" }, { pattern: "or", surface: "or" }, { pattern: "ur", surface: "ur" }, { pattern: "re", surface: "re" }, { pattern: "r", surface: "r" }],
  EY: [{ pattern: "ay", surface: "ay" }, { pattern: "ey", surface: "ey" }, { pattern: "e", surface: "e" }],
  F: [{ pattern: "ph", surface: "ph" }, { pattern: "fe", surface: "fe" }, { pattern: "ff", surface: "f" }, { pattern: "f", surface: "f" }],
  G: [{ pattern: "gg", surface: "g" }, { pattern: "g", surface: "g" }],
  HH: [{ pattern: "h", surface: "h" }],
  IH: [{ pattern: "i", surface: "i" }, { pattern: "y", surface: "y" }],
  IY: [{ pattern: "ay", surface: "ay" }, { pattern: "ee", surface: "ee" }, { pattern: "ea", surface: "ea" }, { pattern: "ie", surface: "ie" }, { pattern: "ey", surface: "ey" }, { pattern: "i", surface: "i" }, { pattern: "y", surface: "y" }, { pattern: "e", surface: "e" }],
  JH: [{ pattern: "ge", surface: "ge" }, { pattern: "j", surface: "j" }, { pattern: "y", surface: "y" }, { pattern: "g", surface: "g" }],
  K: [{ pattern: "ch", surface: "ch" }, { pattern: "ck", surface: "ck" }, { pattern: "k", surface: "k" }, { pattern: "c", surface: "c" }, { pattern: "q", surface: "q" }],
  L: [{ pattern: "le", surface: "le" }, { pattern: "ll", surface: "l" }, { pattern: "l", surface: "l" }],
  M: [{ pattern: "mm", surface: "m" }, { pattern: "m", surface: "m" }],
  N: [{ pattern: "kn", surface: "n" }, { pattern: "gn", surface: "n" }, { pattern: "pn", surface: "n" }, { pattern: "ng", surface: "ng" }, { pattern: "nn", surface: "n" }, { pattern: "n", surface: "n" }],
  NG: [{ pattern: "ng", surface: "ng" }],
  OW: [{ pattern: "ow", surface: "ow" }, { pattern: "ou", surface: "ou" }],
  OY: [{ pattern: "oy", surface: "oy" }, { pattern: "oi", surface: "oi" }],
  P: [{ pattern: "pp", surface: "p" }, { pattern: "p", surface: "p" }],
  R: [{ pattern: "rr", surface: "r" }, { pattern: "r", surface: "r" }],
  S: [{ pattern: "ps", surface: "s" }, { pattern: "sc", surface: "sc" }, { pattern: "ss", surface: "s" }, { pattern: "c", surface: "c" }, { pattern: "s", surface: "s" }],
  SH: [{ pattern: "ti", surface: "ti" }, { pattern: "ci", surface: "ci" }, { pattern: "sh", surface: "sh" }],
  T: [{ pattern: "tt", surface: "t" }, { pattern: "t", surface: "t" }],
  TH: [{ pattern: "th", surface: "th" }],
  UH: [{ pattern: "u", surface: "u" }, { pattern: "oo", surface: "oo" }],
  UW: [{ pattern: "oo", surface: "oo" }, { pattern: "ou", surface: "ou" }, { pattern: "u", surface: "u" }, { pattern: "ew", surface: "ew" }],
  V: [{ pattern: "v", surface: "v" }],
  W: [{ pattern: "wh", surface: "w" }, { pattern: "w", surface: "w" }],
  Y: [{ pattern: "y", surface: "y" }, { pattern: "i", surface: "i" }],
  Z: [{ pattern: "zz", surface: "z" }, { pattern: "s", surface: "s" }, { pattern: "z", surface: "z" }],
  ZH: [{ pattern: "si", surface: "si" }, { pattern: "su", surface: "su" }, { pattern: "ge", surface: "ge" }, { pattern: "zh", surface: "zh" }],
};

const MAX_SILENT_SKIP = 3;
const OPTIONAL_SURFACE_PHONES = new Set(["AH", "IH", "ER"]);

function candidatesForPhone(phone: string): readonly GraphemeCandidate[] {
  return PHONE_GRAPHEMES[phone] ?? [{ pattern: phone.toLowerCase(), surface: phone.toLowerCase() }];
}

function tryMatchAt(
  orthography: string,
  position: number,
  candidates: readonly GraphemeCandidate[],
): { next: number; surface: string } | null {
  const slice = orthography.slice(position);
  const ordered = [...candidates].sort(
    (left, right) => right.pattern.length - left.pattern.length,
  );

  for (const candidate of ordered) {
    if (!slice.startsWith(candidate.pattern)) continue;
    return {
      next: position + candidate.pattern.length,
      surface: candidate.surface,
    };
  }

  return null;
}

function alignFrom(
  orthography: string,
  phones: readonly string[],
  phoneIndex: number,
  position: number,
  surface: string,
): string | null {
  if (phoneIndex >= phones.length) {
    const remainder = orthography.slice(position).replace(/e$/u, "");
    return remainder.length === 0 ? surface : null;
  }

  const phone = phones[phoneIndex]!;
  const candidates = candidatesForPhone(phone);

  for (let skip = 0; skip <= MAX_SILENT_SKIP; skip++) {
    const at = position + skip;
    const matched = tryMatchAt(orthography, at, candidates);
    if (!matched) continue;

    const result = alignFrom(
      orthography,
      phones,
      phoneIndex + 1,
      matched.next,
      surface + matched.surface,
    );
    if (result !== null) return result;
  }

  if (OPTIONAL_SURFACE_PHONES.has(phone)) {
    const skipped = alignFrom(
      orthography,
      phones,
      phoneIndex + 1,
      position,
      surface,
    );
    if (skipped !== null) return skipped;
  }

  return null;
}

/**
 * Align orthography to ARPAbet phones; skip silent graphemes; emit STT-like surface.
 */
export function arpabetAlignedSurface(
  orthography: string,
  phones: readonly string[],
): string | null {
  const word = orthography.toLowerCase().replace(/[^a-z]/g, "");
  if (!word || phones.length === 0) return null;

  return alignFrom(word, phones, 0, 0, "");
}

/** Bounded alternates for phones with multiple common STT spellings. */
export function arpabetSurfaceAlternates(
  orthography: string,
  phones: readonly string[],
): string[] {
  const primary = arpabetAlignedSurface(orthography, phones);
  if (!primary) return [];

  const alternates = new Set<string>([primary]);

  if (primary.includes("ch")) {
    alternates.add(primary.replace(/ch/g, "k"));
  }

  if (primary.includes("ph")) {
    alternates.add(primary.replace(/ph/g, "f"));
  }

  return [...alternates];
}
