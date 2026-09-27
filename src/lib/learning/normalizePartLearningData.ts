import type { PartSentence, PartToken } from "@/types/video";

/**
 * Normalize `parts.tokens` JSON from the DB into `PartToken[]`.
 *
 * The content pipeline stores tokens as `{ value, normalized, visibleInPuzzle, locked, ... }`
 * without `id` or `order`. Older rows may use `{ text, id, order }` already.
 */
export function normalizePartTokens(raw: unknown): PartToken[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: PartToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = normalizeOnePartToken(raw[i], i);
    if (token) out.push(token);
  }
  return out.length > 0 ? out : null;
}

function normalizeOnePartToken(item: unknown, index: number): PartToken | null {
  if (item == null || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  const text = String(o.text ?? o.value ?? "").trim();
  if (!text) return null;

  const visibleRaw = o.visibleInPuzzle ?? o.visible_in_puzzle;
  const visibleInPuzzle =
    visibleRaw === false ? false : visibleRaw === true ? true : true;

  const order =
    typeof o.order === "number" && Number.isFinite(o.order)
      ? o.order
      : index + 1;

  const id =
    o.id != null && String(o.id).length > 0 ? String(o.id) : `token-${index}`;

  const typeRaw = o.type;
  const type =
    typeRaw != null && String(typeRaw).trim().length > 0
      ? String(typeRaw).trim()
      : undefined;

  const punctuationRaw = o.punctuationType ?? o.punctuation_type;
  const punctuationType =
    punctuationRaw != null && String(punctuationRaw).trim().length > 0
      ? String(punctuationRaw).trim()
      : undefined;

  const senseId = optionalTrimmedString(o.senseId ?? o.sense_id);
  const dictionaryEntryId = optionalTrimmedString(
    o.dictionaryEntryId ?? o.dictionary_entry_id,
  );
  const matchedPhrase = optionalTrimmedString(
    o.matchedPhrase ?? o.matched_phrase,
  );

  return {
    id,
    text,
    order,
    visibleInPuzzle,
    locked: o.locked === true,
    type,
    punctuationType,
    normalized:
      o.normalized != null
        ? String(o.normalized).trim() || undefined
        : undefined,
    ...(senseId ? { senseId } : {}),
    ...(dictionaryEntryId ? { dictionaryEntryId } : {}),
    ...(matchedPhrase ? { matchedPhrase } : {}),
  };
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize `parts.sentences` JSON — pipeline stores a string[] of segment texts.
 */
export function normalizePartSentences(raw: unknown): PartSentence[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: PartSentence[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      const text = item.trim();
      if (!text) continue;
      out.push({
        id: `sentence-${i}`,
        text,
        order: i + 1,
      });
      continue;
    }
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = String(
      o.text ?? o.normalizedText ?? o.originalText ?? "",
    ).trim();
    if (!text) continue;
    out.push({
      id:
        o.id != null && String(o.id).length > 0
          ? String(o.id)
          : `sentence-${i}`,
      text,
      order:
        typeof o.order === "number" && Number.isFinite(o.order)
          ? o.order
          : i + 1,
      startMs: typeof o.startMs === "number" ? o.startMs : undefined,
      endMs: typeof o.endMs === "number" ? o.endMs : undefined,
    });
  }
  return out.length > 0 ? out : null;
}
