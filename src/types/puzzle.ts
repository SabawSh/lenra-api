export type PuzzlePart = {
  id: string;
  text: string;
  /** Normalised tokens used for voice matching. */
  tokens: string[];
  /**
   * When true the tile is shown in the pool but cannot be dragged or tapped.
   * Set from `PartToken.locked` for punctuation / fixed words.
   */
  locked?: boolean;
};

/**
 * Cached pronunciation match forms for tile tokens in a puzzle/session.
 * Built via `buildVoiceMatchLexicon` when the puzzle is created — the matcher
 * only reads this map at match time.
 */
export type { VoiceMatchLexicon } from "../helper/speech/voiceMatchLexicon.js";
