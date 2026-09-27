import type { UserId } from "@/types/schema";

export const LEARNING_BUG_REPORT_CATEGORIES = [
  "video",
  "subtitle",
  "puzzle",
  "voice",
  "other",
] as const;

export type LearningBugReportCategory =
  (typeof LEARNING_BUG_REPORT_CATEGORIES)[number];

export const LEARNING_BUG_REPORT_STATUSES = [
  "new",
  "reviewing",
  "fixed",
  "closed",
] as const;

export type LearningBugReportStatus =
  (typeof LEARNING_BUG_REPORT_STATUSES)[number];

export type AdminLearningBugReportRow = {
  id: number;
  userId: UserId;
  userName: string | null;
  userUsername: string | null;
  userEmail: string | null;
  userPhone: string | null;
  partId: string | null;
  videoId: string | null;
  videoName: string | null;
  episodeId: string | null;
  episodeTitle: string | null;
  seasonId: string | null;
  sectionIndex: number | null;
  step: number | null;
  category: LearningBugReportCategory;
  status: LearningBugReportStatus;
  message: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  createdAt: Date;
};

