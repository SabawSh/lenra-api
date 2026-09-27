/**
 * Movie-library + movie-entry content difficulty (pure logic).
 *
 *   npm run test:video-difficulty-mix
 */
import assert from "node:assert/strict";
import {
  buildDifficultyMixFromCounts,
  CONTENT_DIFFICULTY_FILTERS,
  difficultyMixPercents,
  emptyDifficultyMix,
  mapPartDifficultyToBucket,
  parseContentDifficultyFilter,
  partMatchesContentDifficultyFilter,
  recommendContentDifficultyFromEnglishLevel,
  sectionIndicesMatchingContentDifficulty,
  videoMatchesContentDifficultyFilter,
  withContentDifficultyQuery,
} from "./videoDifficultyMix";

function sectionIndexFromOrder(order: number): number {
  return Math.floor((order - 1) / 10) + 1;
}

// hard → advanced mapping
assert.equal(mapPartDifficultyToBucket("easy"), "easy");
assert.equal(mapPartDifficultyToBucket("medium"), "medium");
assert.equal(mapPartDifficultyToBucket("hard"), "advanced");
assert.equal(mapPartDifficultyToBucket("HARD"), "advanced");
assert.equal(mapPartDifficultyToBucket("unknown"), null);
assert.equal(mapPartDifficultyToBucket(null), null);

// grouped counts per video (hard maps to advanced)
{
  const mix = buildDifficultyMixFromCounts({
    easy: 7,
    medium: 2,
    hard: 1,
  });
  assert.deepEqual(mix, {
    easy: 7,
    medium: 2,
    advanced: 1,
    total: 10,
  });
}

// percentages — movie distribution display
{
  const pct = difficultyMixPercents(
    buildDifficultyMixFromCounts({ easy: 7, medium: 2, hard: 1 }),
  );
  assert.ok(pct);
  assert.equal(pct.easy, 70);
  assert.equal(pct.medium, 20);
  assert.equal(pct.advanced, 10);
}

// zero-count → no fake distribution
assert.equal(difficultyMixPercents(emptyDifficultyMix()), null);
assert.equal(difficultyMixPercents(undefined), null);
assert.equal(difficultyMixPercents(null), null);

// filter: contains ≥1 clip in bucket (library semantics)
{
  const easyHeavy = buildDifficultyMixFromCounts({
    easy: 5,
    medium: 0,
    hard: 0,
  });
  const mixed = buildDifficultyMixFromCounts({ easy: 1, medium: 3, hard: 2 });
  const advancedOnly = buildDifficultyMixFromCounts({
    easy: 0,
    medium: 0,
    hard: 4,
  });
  const empty = emptyDifficultyMix();

  assert.equal(videoMatchesContentDifficultyFilter(easyHeavy, "All"), true);
  assert.equal(videoMatchesContentDifficultyFilter(easyHeavy, "easy"), true);
  assert.equal(videoMatchesContentDifficultyFilter(easyHeavy, "medium"), false);
  assert.equal(
    videoMatchesContentDifficultyFilter(easyHeavy, "advanced"),
    false,
  );

  assert.equal(videoMatchesContentDifficultyFilter(mixed, "easy"), true);
  assert.equal(videoMatchesContentDifficultyFilter(mixed, "medium"), true);
  assert.equal(videoMatchesContentDifficultyFilter(mixed, "advanced"), true);

  assert.equal(
    videoMatchesContentDifficultyFilter(advancedOnly, "advanced"),
    true,
  );
  assert.equal(videoMatchesContentDifficultyFilter(advancedOnly, "easy"), false);

  assert.equal(videoMatchesContentDifficultyFilter(empty, "All"), true);
  assert.equal(videoMatchesContentDifficultyFilter(empty, "easy"), false);
  assert.equal(videoMatchesContentDifficultyFilter(undefined, "medium"), false);
}

// CEFR / type / genre filters remain independent
{
  const item = {
    levels: ["A2", "B1"],
    genres: ["Drama"],
    type: "movie" as const,
    difficultyMix: buildDifficultyMixFromCounts({ easy: 0, medium: 2, hard: 1 }),
  };
  assert.ok(item.levels.includes("A2"));
  assert.equal(
    videoMatchesContentDifficultyFilter(item.difficultyMix, "medium"),
    true,
  );
  assert.equal(
    videoMatchesContentDifficultyFilter(item.difficultyMix, "easy"),
    false,
  );
  assert.deepEqual(item.levels, ["A2", "B1"]);
}

assert.deepEqual(CONTENT_DIFFICULTY_FILTERS, [
  "All",
  "easy",
  "medium",
  "advanced",
]);

// Default selection is All (parse missing / invalid)
assert.equal(parseContentDifficultyFilter(undefined), "All");
assert.equal(parseContentDifficultyFilter(null), "All");
assert.equal(parseContentDifficultyFilter(""), "All");
assert.equal(parseContentDifficultyFilter("nope"), "All");
assert.equal(parseContentDifficultyFilter("Easy"), "easy");
assert.equal(parseContentDifficultyFilter("medium"), "medium");
assert.equal(parseContentDifficultyFilter("advanced"), "advanced");

// Clip-level filter (movie entry content selection)
{
  assert.equal(partMatchesContentDifficultyFilter("easy", "All"), true);
  assert.equal(partMatchesContentDifficultyFilter("easy", "easy"), true);
  assert.equal(partMatchesContentDifficultyFilter("easy", "medium"), false);
  assert.equal(partMatchesContentDifficultyFilter("hard", "advanced"), true);
  assert.equal(partMatchesContentDifficultyFilter("medium", "advanced"), false);
}

// Selecting Easy / Medium / Advanced / All restores section membership
{
  const parts = [
    { order: 1, difficulty: "easy" },
    { order: 2, difficulty: "easy" },
    { order: 11, difficulty: "medium" },
    { order: 12, difficulty: "hard" },
    { order: 21, difficulty: "hard" },
  ];

  const all = sectionIndicesMatchingContentDifficulty(
    parts,
    "All",
    sectionIndexFromOrder,
  );
  assert.deepEqual([...all].sort((a, b) => a - b), [1, 2, 3]);

  const easy = sectionIndicesMatchingContentDifficulty(
    parts,
    "easy",
    sectionIndexFromOrder,
  );
  assert.deepEqual([...easy].sort((a, b) => a - b), [1]);

  const medium = sectionIndicesMatchingContentDifficulty(
    parts,
    "medium",
    sectionIndexFromOrder,
  );
  assert.deepEqual([...medium].sort((a, b) => a - b), [2]);

  const advanced = sectionIndicesMatchingContentDifficulty(
    parts,
    "advanced",
    sectionIndexFromOrder,
  );
  assert.deepEqual([...advanced].sort((a, b) => a - b), [2, 3]);

  const restored = sectionIndicesMatchingContentDifficulty(
    parts,
    "All",
    sectionIndexFromOrder,
  );
  assert.deepEqual([...restored].sort((a, b) => a - b), [1, 2, 3]);
}

// Recommendation: missing level does not break / returns null
{
  const mix = buildDifficultyMixFromCounts({ easy: 5, medium: 3, hard: 1 });
  assert.equal(recommendContentDifficultyFromEnglishLevel(null, mix), null);
  assert.equal(recommendContentDifficultyFromEnglishLevel(undefined, mix), null);
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("intermediate", emptyDifficultyMix()),
    null,
  );
}

// Recommendation maps level → bucket but never forces selection
{
  const mix = buildDifficultyMixFromCounts({ easy: 5, medium: 3, hard: 1 });
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("beginner", mix),
    "easy",
  );
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("elementary", mix),
    "easy",
  );
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("intermediate", mix),
    "medium",
  );
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("upperIntermediate", mix),
    "medium",
  );
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("advanced", mix),
    "advanced",
  );
  // Recommendation is advisory only — default filter stays All independently
  let selected = parseContentDifficultyFilter(undefined);
  assert.equal(selected, "All");
  const tip = recommendContentDifficultyFromEnglishLevel("intermediate", mix);
  assert.equal(tip, "medium");
  assert.equal(selected, "All");
  selected = tip!;
  assert.equal(selected, "medium");
  selected = "All";
  assert.equal(selected, "All");
}

// Recommendation suppressed when movie has no clips in that bucket
{
  const advancedOnly = buildDifficultyMixFromCounts({
    easy: 0,
    medium: 0,
    hard: 4,
  });
  assert.equal(
    recommendContentDifficultyFromEnglishLevel("beginner", advancedOnly),
    null,
  );
}

// Learn href query append / clear (selector → play link)
{
  const base =
    "/learn/movie/abc/section/1?step=1&autoplay=1";
  assert.equal(
    withContentDifficultyQuery(base, "easy"),
    "/learn/movie/abc/section/1?step=1&autoplay=1&contentDifficulty=easy",
  );
  assert.equal(
    withContentDifficultyQuery(
      "/learn/movie/abc/section/1?step=1&autoplay=1&contentDifficulty=easy",
      "All",
    ),
    "/learn/movie/abc/section/1?step=1&autoplay=1",
  );
  assert.equal(withContentDifficultyQuery(null, "easy"), null);
}

// Selector options stable for LTR/RTL (order does not depend on locale)
assert.deepEqual([...CONTENT_DIFFICULTY_FILTERS], [
  "All",
  "easy",
  "medium",
  "advanced",
]);

// Batched aggregation contract (application-side fold of GROUP BY rows)
{
  type Row = { video_id: string; difficulty: string; c: number };
  const rows: Row[] = [
    { video_id: "v1", difficulty: "easy", c: 7 },
    { video_id: "v1", difficulty: "medium", c: 2 },
    { video_id: "v1", difficulty: "hard", c: 1 },
    { video_id: "v2", difficulty: "hard", c: 3 },
  ];
  const byVideo = new Map<
    string,
    { easy: number; medium: number; hard: number }
  >();
  for (const row of rows) {
    const entry = byVideo.get(row.video_id) ?? {
      easy: 0,
      medium: 0,
      hard: 0,
    };
    if (row.difficulty === "easy") entry.easy += row.c;
    else if (row.difficulty === "medium") entry.medium += row.c;
    else if (row.difficulty === "hard") entry.hard += row.c;
    byVideo.set(row.video_id, entry);
  }
  assert.deepEqual(buildDifficultyMixFromCounts(byVideo.get("v1")!), {
    easy: 7,
    medium: 2,
    advanced: 1,
    total: 10,
  });
  assert.deepEqual(buildDifficultyMixFromCounts(byVideo.get("v2")!), {
    easy: 0,
    medium: 0,
    advanced: 3,
    total: 3,
  });
}

console.log("videoDifficultyMix.validation: ok");
