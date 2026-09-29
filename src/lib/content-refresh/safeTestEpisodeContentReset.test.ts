import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLearnerProgressBlockers } from "./safeTestEpisodeContentReset";

describe("buildLearnerProgressBlockers", () => {
  it("allows reset when all learner tables are empty", () => {
    assert.deepEqual(
      buildLearnerProgressBlockers({
        willDeleteUserPartProgress: 0,
        willDeleteUserTokenMarks: 0,
        willDeleteSavedVocabularyCards: 0,
      }),
      [],
    );
  });

  it("blocks when user_part_progress exists", () => {
    const blockers = buildLearnerProgressBlockers({
      willDeleteUserPartProgress: 3,
      willDeleteUserTokenMarks: 0,
      willDeleteSavedVocabularyCards: 0,
    });
    assert.match(blockers.join(" "), /user_part_progress: 3/);
  });

  it("lists every learner progress table with counts", () => {
    const blockers = buildLearnerProgressBlockers({
      willDeleteUserPartProgress: 1,
      willDeleteUserTokenMarks: 2,
      willDeleteSavedVocabularyCards: 4,
    });
    assert.equal(blockers.length, 3);
  });
});
