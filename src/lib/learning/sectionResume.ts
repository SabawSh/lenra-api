import {
  orderFromSectionPart,
  partInSectionFromOrder,
  sectionIndexFromOrder,
  VISIBLE_UNITS_PER_SECTION,
} from "@/lib/learning/sections";

export type UserLastPosition = {
  sectionIndex: number;
  /** 1-based visible learning unit step within the section (never atomic). */
  visibleUnitStep: number;
};

/** @deprecated Use `visibleUnitStep` — kept for API JSON compatibility. */
export type UserLastPositionLegacy = UserLastPosition & {
  partInSection: number;
};

/** 1-based visible unit step to open when entering a section from the list. */
export function resolveSectionStartStep(
  sectionIndex: number,
  visibleUnitCount: number = VISIBLE_UNITS_PER_SECTION,
  userLastPosition: UserLastPosition | null | undefined,
): number {
  const isResumeSection = userLastPosition?.sectionIndex === sectionIndex;
  if (!isResumeSection || !userLastPosition) return 1;

  const resumeStep = userLastPosition.visibleUnitStep;
  if (resumeStep > visibleUnitCount) return 1;
  if (resumeStep < 1) return 1;
  return resumeStep;
}

/** @deprecated Use `resolveSectionStartStep`. */
export function resolveSectionStartPart(
  sectionIndex: number,
  visibleUnitCount: number,
  userLastPosition: UserLastPosition | null | undefined,
): number {
  return resolveSectionStartStep(sectionIndex, visibleUnitCount, userLastPosition);
}

export function buildSectionPlayHref(
  _unlocked: boolean,
  videoId: string,
  seasonId: string,
  episodeId: string,
  sectionIndex: number,
  startStep: number,
): string | null {
  if (!_unlocked) return null;
  const step = Math.max(1, Math.min(startStep, VISIBLE_UNITS_PER_SECTION));
  return `/learn/series/${videoId}/${seasonId}/${episodeId}/section/${sectionIndex}?step=${step}&autoplay=1`;
}

export function buildMovieSectionPlayHref(
  _unlocked: boolean,
  learnType: "movie" | "documentary",
  videoId: string,
  sectionIndex: number,
  startStep: number,
): string | null {
  if (!_unlocked) return null;
  const step = Math.max(1, Math.min(startStep, VISIBLE_UNITS_PER_SECTION));
  return `/learn/${learnType}/${videoId}/section/${sectionIndex}?step=${step}&autoplay=1`;
}

/** Replay a fully completed batch from clip 1 (composed playlist, not summary). */
export const BATCH_REVIEW_QUERY = "batchReview";

export function withBatchReviewPlayQuery(href: string | null): string | null {
  if (!href) return null;
  const sep = href.includes("?") ? "&" : "?";
  if (href.includes(`${BATCH_REVIEW_QUERY}=`)) return href;
  return `${href}${sep}${BATCH_REVIEW_QUERY}=1`;
}

export function firstClipOrderForSection(sectionIndex: number): number {
  return orderFromSectionPart(sectionIndex, 1);
}

/** Encode section + visible step into the bookmark `order` column. */
export function bookmarkOrderForVisibleStep(
  sectionIndex: number,
  visibleUnitStep: number,
): number {
  return orderFromSectionPart(sectionIndex, visibleUnitStep);
}

/** Decode a bookmark `order` into section + visible unit step. */
export function visibleStepFromBookmarkOrder(order: number): {
  sectionIndex: number;
  visibleUnitStep: number;
} {
  return {
    sectionIndex: sectionIndexFromOrder(order),
    visibleUnitStep: partInSectionFromOrder(order),
  };
}
