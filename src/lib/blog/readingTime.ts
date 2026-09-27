import type { ArticleBlock } from "./types";

/** Rough reading time from block text (Persian + English mixed). */
export function estimateReadingMinutes(blocks: ArticleBlock[]): number {
  let words = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
        words += countWords(block.text);
        break;
      case "expression_lesson":
        words +=
          countWords(block.expression) +
          countWords(block.contextualExplanation) +
          countWords(block.meaningFa) +
          countWords(block.source.english) +
          countWords(block.source.persian);
        break;
      case "vocabulary":
        words += countWords(block.word) + countWords(block.meaningFa);
        break;
      case "dialogue":
        words += countWords(block.english) + countWords(block.persian ?? "");
        break;
      default:
        break;
    }
  }
  return Math.max(1, Math.ceil(words / 180));
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateReadingMinutesFromExcerpt(
  excerpt: string | null,
  title: string,
): number {
  const words = countWords(title) + countWords(excerpt ?? "");
  return Math.max(1, Math.ceil(words / 180));
}
