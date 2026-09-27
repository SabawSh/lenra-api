/**
 * Batch clip dedupe + continue priority.
 *
 *   npm run test:batch-clip-dedupe
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  dedupeByPartId,
  resolveBatchContinueClipIndex,
} from "./batchClipDedupe";

{
  const items = [
    { partId: "a", label: "1" },
    { partId: "b", label: "2" },
    { partId: "a", label: "dup" },
    { partId: "c", label: "3" },
  ];
  const deduped = dedupeByPartId(items);
  assert.deepEqual(
    deduped.map((x) => x.partId),
    ["a", "b", "c"],
  );
  assert.equal(deduped[0]!.label, "1");
}

assert.deepEqual(dedupeByPartId([{ partId: "" }, { partId: "x" }]), [
  { partId: "x" },
]);

{
  const clips = [
    { clipIndex: 1, completed: true, state: "completed" as const },
    { clipIndex: 2, completed: true, state: "review" as const },
    { clipIndex: 3, completed: false, state: "new" as const },
    { clipIndex: 4, completed: false, state: "review" as const },
  ];
  // Prefer fresh incomplete over review incomplete
  assert.equal(resolveBatchContinueClipIndex(clips, 1), 3);
}

{
  const clips = [
    { clipIndex: 1, completed: true, state: "completed" as const },
    { clipIndex: 2, completed: true, state: "review" as const },
    { clipIndex: 3, completed: true, state: "completed" as const },
  ];
  // All done → first due review
  assert.equal(resolveBatchContinueClipIndex(clips, 9), 2);
}

{
  const clips = [
    { clipIndex: 1, completed: true, state: "completed" as const },
    { clipIndex: 2, completed: true, state: "completed" as const },
  ];
  assert.equal(resolveBatchContinueClipIndex(clips, 7), 7);
}

// Reminder cards: no Persian translation field in sidebar type usage
{
  const sidebar = readFileSync(
    join(process.cwd(), "lib/learning/loadMovieLearningSidebar.ts"),
    "utf8",
  );
  assert.match(sidebar, /englishText/);
  assert.match(sidebar, /state: "review"/);
  assert.match(sidebar, /listSavedCardIdByClipForUserParts/);
  assert.doesNotMatch(
    sidebar,
    /translationText/,
  );
}

{
  const ui = readFileSync(
    join(
      process.cwd(),
      "components/organisms/episodeSections/MovieLearningBatchExperience.tsx",
    ),
    "utf8",
  );
  assert.match(ui, /ReminderClipCard/);
  assert.match(ui, /SavedVocabWordRow/);
  assert.match(ui, /speakEnglishLemma/);
  assert.match(ui, /stopPropagation/);
  // Reminder card must not render Persian translation
  assert.match(ui, /English only, no Persian/);
  // Sections page must not fetch HLS for clip thumbs
  assert.match(ui, /hlsManifestUrl=\{null\}/);
  assert.match(ui, /videoUrl=\{null\}/);
}

{
  const preview = readFileSync(
    join(process.cwd(), "lib/learning/loadMovieLearningBatchPreview.ts"),
    "utf8",
  );
  assert.match(preview, /dedupeClipCardsByPartId/);
  assert.match(preview, /resolveBatchContinueClipIndex/);
  assert.match(preview, /resolveBatchPreviewParts|findMaterializedSectionHeader/);
  assert.match(preview, /mergeSectionDisplayPartIds/);
  assert.match(preview, /completedSlots/);
  assert.doesNotMatch(preview, /getOrMaterializeProgressionSection/);
}

{
  const header = readFileSync(
    join(process.cwd(), "components/dictionary/DictionaryHeader.tsx"),
    "utf8",
  );
  assert.match(header, /speakEnglishLemma/);
  assert.match(header, /Volume2/);
}

console.log("batchClipDedupe.validation: ok");
