export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
