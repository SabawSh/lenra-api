import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import {
  updateLearningBugReportStatus,
} from "@/lib/db/queries/learningBugReports";
import {
  LEARNING_BUG_REPORT_STATUSES,
  type LearningBugReportStatus,
} from "@/lib/learning/bugReports";
import { NextResponse } from "next/server";

function isLearningBugReportStatus(
  value: unknown,
): value is LearningBugReportStatus {
  return (
    typeof value === "string" &&
    LEARNING_BUG_REPORT_STATUSES.includes(value as LearningBugReportStatus)
  );
}

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, user };
}

export async function PATCH(req: Request) {
  const admin = await assertAdmin();
  if (!admin.ok) return admin.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!record) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const reportId =
    typeof record.reportId === "number" && Number.isInteger(record.reportId)
      ? record.reportId
      : null;
  if (!reportId || reportId < 1) {
    return NextResponse.json({ error: "Invalid reportId" }, { status: 400 });
  }

  if (!isLearningBugReportStatus(record.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const updated = await updateLearningBugReportStatus({
      reportId,
      status: record.status,
    });
    if (!updated) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, reportId, status: record.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

