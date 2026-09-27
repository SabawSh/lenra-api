import type { CaptionTranslation } from "@/types/video";

function normalizeTranslatedSentences(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Display text for one translation row attached to a part. */
export function translationDisplayText(
  row: Pick<CaptionTranslation, "text" | "translatedSentences"> | {
    text: string;
    translatedSentences?: unknown;
  },
): string {
  const fromSentences = normalizeTranslatedSentences(row.translatedSentences);
  if (fromSentences.length > 0) return fromSentences;
  return row.text.trim();
}

export function translationLinesFromPartRows(
  translations:
    | readonly Pick<CaptionTranslation, "text" | "translatedSentences">[]
    | readonly {
        text: string;
        translatedSentences?: unknown;
      }[]
    | undefined,
): { text: string }[] {
  return (translations ?? [])
    .map((row) => translationDisplayText(row))
    .filter((text) => text.length > 0)
    .map((text) => ({ text }));
}

/** Prefer Persian caption row when present; otherwise first available translation. */
export function pickFaOrFirstTranslation(
  translations:
    | readonly (Pick<CaptionTranslation, "text" | "translatedSentences" | "language"> & {
        language?: string;
      })[]
    | undefined,
): string | null {
  if (!translations?.length) return null;
  const fa = translations.find((row) => {
    const lang = String(row.language ?? "")
      .trim()
      .toLowerCase();
    return lang === "fa" || lang.startsWith("fa-") || lang === "persian";
  });
  const row = fa ?? translations[0]!;
  const text = translationDisplayText(row);
  return text.length > 0 ? text : null;
}
