/**
 * Vocabulary save bridge — dictionary ownership + optional Clip contextual card.
 *
 *   npm run test:vocabulary-save-bridge
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  normalizeSavedVocabularyWord,
  resolveContextualCardWords,
  shouldWriteContextualSavedCard,
} from "./vocabularySaveBridgeLogic";

assert.equal(normalizeSavedVocabularyWord("  Door! "), "door");
assert.equal(normalizeSavedVocabularyWord("It's"), "it's");
assert.equal(normalizeSavedVocabularyWord(""), "");
assert.equal(normalizeSavedVocabularyWord(null), "");

assert.equal(shouldWriteContextualSavedCard("part-123"), true);
assert.equal(shouldWriteContextualSavedCard("  "), false);
assert.equal(shouldWriteContextualSavedCard(null), false);
assert.equal(shouldWriteContextualSavedCard(undefined), false);

{
  const words = resolveContextualCardWords({ word: "Door", lemma: "door" });
  assert.ok(words);
  assert.equal(words!.word, "Door");
  assert.equal(words!.normalizedWord, "door");
}

{
  const words = resolveContextualCardWords({ word: null, lemma: "dream" });
  assert.ok(words);
  assert.equal(words!.normalizedWord, "dream");
}

assert.equal(
  resolveContextualCardWords({ word: "!!!", lemma: null }),
  null,
);

// Source contracts: Clip save bridges both tables; dictionary-only stays valid.
{
  const route = readFileSync(
    join(process.cwd(), "app/api/user-vocabulary/route.ts"),
    "utf8",
  );
  assert.match(route, /upsertUserVocabularyEntry/);
  assert.match(route, /upsertContextualSavedCardForClip/);
  assert.match(route, /shouldWriteContextualSavedCard/);
  assert.match(route, /clipId/);
  assert.match(route, /contextualCard/);
}

{
  const provider = readFileSync(
    join(process.cwd(), "components/dictionary/WordDictionaryProvider.tsx"),
    "utf8",
  );
  assert.match(provider, /clipSaveContextRef/);
  assert.match(provider, /clipId: clipCtx\?\.clipId/);
  assert.match(provider, /saveUserVocabularyEntry/);
}

{
  const player = readFileSync(
    join(
      process.cwd(),
      "components/organisms/videoLearningPlayer.tsx",
    ),
    "utf8",
  );
  assert.match(player, /clipId: activePuzzlePart\.id/);
  assert.match(player, /sentence: activePuzzlePart\.text/);
}

{
  const bridge = readFileSync(
    join(process.cwd(), "lib/learning/vocabularySaveBridge.ts"),
    "utf8",
  );
  assert.match(bridge, /upsertSavedVocabularyCard/);
  assert.match(bridge, /fetchPartVocabularyContext/);
  assert.match(bridge, /clipId: part\.id/);
}

// Learning queries still key off saved_vocabulary_cards.clip_id (= part id)
{
  const preview = readFileSync(
    join(process.cwd(), "lib/learning/loadMovieLearningBatchPreview.ts"),
    "utf8",
  );
  assert.match(preview, /listSavedCardIdByClipForUserParts/);
}

{
  const sidebar = readFileSync(
    join(process.cwd(), "lib/learning/loadMovieLearningSidebar.ts"),
    "utf8",
  );
  assert.match(sidebar, /listRecentSavedWordsForVideo/);
}

// Unsave contextual card must not delete user_vocabulary (no destructive coupling)
{
  const saveCard = readFileSync(
    join(process.cwd(), "app/api/learning/save-card/route.ts"),
    "utf8",
  );
  assert.match(saveCard, /deleteSavedVocabularyCardsForUserClip/);
  assert.doesNotMatch(saveCard, /user_vocabulary/);
  assert.doesNotMatch(saveCard, /upsertUserVocabularyEntry/);
}

{
  const vocabDelete = readFileSync(
    join(process.cwd(), "app/api/vocabulary/[id]/route.ts"),
    "utf8",
  );
  assert.match(vocabDelete, /deleteSavedVocabularyCardForUser/);
  assert.doesNotMatch(vocabDelete, /DELETE FROM user_vocabulary/);
}

// Learning bookmark still writes saved_vocabulary_cards via shared bridge path
{
  const vocabPost = readFileSync(
    join(process.cwd(), "app/api/vocabulary/route.ts"),
    "utf8",
  );
  assert.match(vocabPost, /upsertContextualSavedCardForClip/);
}

console.log("vocabularySaveBridge.validation: ok");
