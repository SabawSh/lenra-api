const REPLACEMENTS: Record<string, string> = {
  gonna: "going to",
  wanna: "want to",
  gotta: "got to",
};

/** Straight and curly apostrophes — ASR omits them ("dont" vs subtitle "don't"). */
const APOSTROPHE_RE = /[\u2018\u2019']/g;

/**
 * Pipeline / ASR often stores apostrophe-less forms. Map back for puzzle tiles only.
 * Skips words that already contain an apostrophe.
 */
const CONTRACTION_DISPLAY: Record<string, string> = {
  cant: "can't",
  couldnt: "couldn't",
  didnt: "didn't",
  doesnt: "doesn't",
  dont: "don't",
  hadnt: "hadn't",
  hasnt: "hasn't",
  havent: "haven't",
  hes: "he's",
  im: "I'm",
  isnt: "isn't",
  ive: "I've",
  lets: "let's",
  mustnt: "mustn't",
  shouldnt: "shouldn't",
  thats: "that's",
  theres: "there's",
  wheres: "where's",
  theyll: "they'll",
  theyre: "they're",
  wasnt: "wasn't",
  werent: "weren't",
  whats: "what's",
  wont: "won't",
  wouldnt: "wouldn't",
  youll: "you'll",
  youre: "you're",
  its: "it's",
  weve: "we've",
  youve: "you've",
  theyve: "they've",
};

/**
 * Strip punctuation that should not appear on puzzle tiles (standalone dashes,
 * ellipsis, em dashes). Keeps apostrophes in contractions and hyphens in words.
 */
export function cleanChunkDisplay(text: string): string {
  return text
    .replace(/(?<!\w)-(?!\w)/g, "")
    .replace(/\.{2,}/g, "")
    .replace(/—/g, "")
    .replace(/^[^\w']+|[^\w']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Learner-facing copy: restore apostrophes when the source omits them. */
export function formatDisplayText(text: string): string {
  if (!text) return text;

  return text.replace(/\b[\w']+\b/g, (word) => {
    if (APOSTROPHE_RE.test(word)) return word;
    const mapped = CONTRACTION_DISPLAY[word.toLowerCase()];
    return mapped ?? word;
  });
}

/**
 * Canonical form for voice ↔ puzzle token comparison.
 * Display text (`PartToken.text` / `value`) keeps apostrophes; matching does not.
 */
export function normalizeSpeechToken(word: string): string {
  return normalizeText(word);
}

export function normalizeText(text?: string): string {
  if (!text || typeof text !== "string") return "";

  let t = text.toLowerCase();

  t = t.replace(/\.{2,}/g, " ");
  // Hyphens are word boundaries for voice matching (bone-density ≡ bone density).
  t = t.replace(/-/g, " ");
  t = t.replace(/—/g, " ");

  Object.entries(REPLACEMENTS).forEach(([k, v]) => {
    t = t.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  });

  /** Web Speech commonly mis-hears stressed “no …” clauses as “know …”. */
  t = t.replace(/\bknow you\b/g, "no you");
  t = t.replace(/\bknow i\b/g, "no i");

  // Subtitles often omit spaces after commas ("dream,No"). Stripping punctuation
  // blindly would glue words ("dreamno"); enforce a boundary before removal.
  t = t.replace(/(\w+),(\w+)/g, "$1 $2");

  // Fold contractions for ASR: "don't"/"dont" → "dont", "it's"/"its" → "its".
  t = t.replace(APOSTROPHE_RE, "");

  return t
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
