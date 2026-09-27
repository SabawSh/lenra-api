/**
 * Client-side lemma pronunciation. Lenra has no dictionary audio URL column;
 * reuse the browser Speech Synthesis API rather than a new generation pipeline.
 */
export function canSpeakEnglishLemma(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/** Speak an English lemma/word. No-op when speech synthesis is unavailable. */
export function speakEnglishLemma(raw: string): boolean {
  const text = raw.trim();
  if (!text || !canSpeakEnglishLemma()) return false;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
