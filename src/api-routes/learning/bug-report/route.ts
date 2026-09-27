import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { insertLearningBugReport } from "@/lib/db/queries/learningBugReports";
import {
  LEARNING_BUG_REPORT_CATEGORIES,
  type LearningBugReportCategory,
} from "@/lib/learning/bugReports";
import { NextResponse } from "next/server";

const MAX_MESSAGE_LENGTH = 2000;

function optionalString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function optionalInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function parseCategory(value: unknown): LearningBugReportCategory | null {
  if (typeof value !== "string") return null;
  return LEARNING_BUG_REPORT_CATEGORIES.includes(
    value as LearningBugReportCategory,
  )
    ? (value as LearningBugReportCategory)
    : null;
}

export async function POST(req: Request) {
  const auth = await requireLearningUser();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const category = parseCategory(body.category);
  if (!category) {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const message = optionalString(body.message, MAX_MESSAGE_LENGTH);
  const pageUrl = optionalString(body.pageUrl, 2048);
  const userAgent =
    optionalString(req.headers.get("user-agent"), 512) ??
    optionalString(body.userAgent, 512);

  try {
    const id = await insertLearningBugReport({
      userId: auth.user.id,
      partId: optionalString(body.partId, 36),
      videoId: optionalString(body.videoId, 36),
      episodeId: optionalString(body.episodeId, 36),
      seasonId: optionalString(body.seasonId, 36),
      sectionIndex: optionalInt(body.sectionIndex),
      step: optionalInt(body.step),
      category,
      message,
      pageUrl,
      userAgent,
    });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    const code = (err as { code?: string; errno?: number }).code;
    const errno = (err as { errno?: number }).errno;
    if (code === "ER_NO_SUCH_TABLE" || errno === 1146) {
      return NextResponse.json(
        {
          error: "bug_reports_table_missing",
          message: "Run: npm run db:migrate:push",
        },
        { status: 503 },
      );
    }
    console.error("[learning/bug-report]", err);
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }
}
