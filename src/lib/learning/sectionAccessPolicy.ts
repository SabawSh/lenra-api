/**
 * Section content-access policy.
 *
 * CONTENT ACCESS (this module): any valid section belonging to the movie/episode
 * is open — progress does not gate navigation.
 *
 * LEARNING PROGRESS (elsewhere): completion, resume, highest_unlocked_section
 * for Continue Learning / analytics remain tracked independently.
 */

/** Product rule: sequential completion is not required to open a section. */
export const SECTION_CONTENT_ACCESS_UNRESTRICTED = true;

/**
 * Whether a learner may open this section as content.
 * Does NOT encode completion or resume state.
 */
export function isSectionContentAccessible(sectionIndex: number): boolean {
  if (!SECTION_CONTENT_ACCESS_UNRESTRICTED) {
    // Legacy sequential gate lived in isSectionUnlockedForUser / unlock rows.
    return sectionIndex <= 1;
  }
  return Number.isFinite(sectionIndex) && sectionIndex >= 1;
}
