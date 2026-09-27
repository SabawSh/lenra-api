import { EPISODE_SECTIONS_PAGE_BATCH } from "@/lib/learning/episodeSectionsBatch";

export function parseSectionsPageQuery(searchParams: URLSearchParams): {
  startSectionIndex: number;
  sectionLimit: number;
} {
  const rawStart = searchParams.get("startSection");
  const rawLimit = searchParams.get("limit");

  const startSectionIndex =
    rawStart != null && !Number.isNaN(+rawStart) && +rawStart >= 1
      ? Math.floor(+rawStart)
      : 1;

  const sectionLimit =
    rawLimit != null && !Number.isNaN(+rawLimit) && +rawLimit >= 1
      ? Math.min(Math.floor(+rawLimit), 50)
      : EPISODE_SECTIONS_PAGE_BATCH;

  return { startSectionIndex, sectionLimit };
}
