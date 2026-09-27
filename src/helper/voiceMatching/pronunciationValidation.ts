import { scoreTokenPhoneticDistance } from "@/helper/speech/phoneticDistance";
import { MIN_PRONUNCIATION_SIMILARITY } from "./voiceMatchingConfig";
import type { AlignmentResult, GateResult } from "./types";

/**
 * Phonetic rescue runs only after evidence and alignment pass.
 * Never creates evidence.
 */
export function validatePronunciation(alignment: AlignmentResult): GateResult {
  if (alignment.alignments.length === 0) {
    return { pass: false, reason: "LOW_PRONUNCIATION" };
  }

  for (const row of alignment.alignments) {
    const similarity = scoreTokenPhoneticDistance(row.expected, row.spoken).similarity;
    if (similarity < MIN_PRONUNCIATION_SIMILARITY) {
      return { pass: false, reason: "LOW_PRONUNCIATION" };
    }
  }

  return { pass: true };
}
