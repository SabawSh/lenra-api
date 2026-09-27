const POS_LABELS_FA: Record<string, string> = {
  verb: "فعل",
  noun: "اسم",
  adjective: "صفت",
  adverb: "قید",
  pronoun: "ضمیر",
  preposition: "حرف اضافه",
  conjunction: "حرف ربط",
  interjection: "حرف ندا",
  determiner: "تعیین‌کننده",
  article: "حرف تعریف",
  numeral: "عدد",
  particle: "حرف",
  auxiliary: "فعل کمکی",
  modal: "فعل وجهی",
  phrase: "عبارت",
};

const POS_LABELS_EN: Record<string, string> = {
  verb: "Verb",
  noun: "Noun",
  adjective: "Adjective",
  adverb: "Adverb",
  pronoun: "Pronoun",
  preposition: "Preposition",
  conjunction: "Conjunction",
  interjection: "Interjection",
  determiner: "Determiner",
  article: "Article",
  numeral: "Numeral",
  particle: "Particle",
  auxiliary: "Auxiliary verb",
  modal: "Modal verb",
  phrase: "Phrase",
};

export function formatPartOfSpeech(
  pos: string | null | undefined,
  locale: string,
): string | null {
  if (!pos?.trim()) return null;
  const key = pos.trim().toLowerCase();
  const isFa = locale.toLowerCase().startsWith("fa");
  const labels = isFa ? POS_LABELS_FA : POS_LABELS_EN;
  return labels[key] ?? pos.trim();
}

export type CefrTier = "beginner" | "intermediate" | "advanced";

export function getCefrTier(cefr: string | null | undefined): CefrTier | null {
  if (!cefr?.trim()) return null;
  const level = cefr.trim().toUpperCase();
  if (level === "A1" || level === "A2") return "beginner";
  if (level === "B1" || level === "B2") return "intermediate";
  if (level === "C1" || level === "C2") return "advanced";
  return null;
}

export function cefrBadgeClassName(tier: CefrTier | null): string {
  switch (tier) {
    case "beginner":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-200";
    case "intermediate":
      return "border-amber-400/35 bg-amber-500/15 text-amber-200";
    case "advanced":
      return "border-rose-400/35 bg-rose-500/15 text-rose-200";
    default:
      return "border-white/15 bg-white/8 text-white/60";
  }
}

export function displayLemma(word: string): string {
  return word.trim().toUpperCase();
}

export function formatIpa(ipa: string | null | undefined): string | null {
  if (!ipa?.trim()) return null;
  const trimmed = ipa.trim();
  if (trimmed.startsWith("/") && trimmed.endsWith("/")) return trimmed;
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}
