import { scopePartTokenId } from "@/lib/learning/scopeMergedPartIds";
import type { Part, PartToken } from "@/types/video";
import { resolveSpeechDurationMs } from "@/lib/learning/partTiming";

/**
 * Virtual merge for playback / puzzle — no new media files.
 * Concatenates text, tokens, and translation rows from adjacent atomic clips.
 */
export function combinePartsForLearning(parts: readonly Part[]): Part {
  if (parts.length === 0) {
    throw new Error("combinePartsForLearning requires at least one part");
  }

  if (parts.length === 1) {
    return parts[0]!;
  }

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;

  const text = parts
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join(" ");

  const normalizedText = parts
    .map((p) => (p.normalizedText ?? p.text).trim())
    .filter(Boolean)
    .join(" ");

  let globalOrder = 0;
  const tokens: PartToken[] = parts.flatMap((p) =>
    (p.tokens ?? []).map((t) => {
      globalOrder += 1;
      return {
        ...t,
        id: scopePartTokenId(p.id, t.id),
        order: globalOrder,
      };
    }),
  );
  const sentences = parts.flatMap((p) => p.sentences ?? []);

  const difficultyScore =
    parts.reduce((sum, p) => sum + (p.difficultyScore ?? 0), 0) / parts.length;

  const speechDurationMs = parts.reduce(
    (sum, p) => sum + resolveSpeechDurationMs(p),
    0,
  );

  return {
    ...first,
    id: parts.map((p) => p.id).join("+"),
    text,
    normalizedText,
    tokens: tokens.length > 0 ? tokens : first.tokens,
    sentences: sentences.length > 0 ? sentences : first.sentences,
    wordCount: parts.reduce((sum, p) => sum + p.wordCount, 0),
    speechDurationMs,
    speechStartMs: first.speechStartMs,
    speechEndMs: last.speechEndMs,
    difficultyScore,
    translations: parts.flatMap((p) => p.translations ?? []),
  };
}
