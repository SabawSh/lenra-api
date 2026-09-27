import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { loadRemindersPage } from "@/services/pages/remindersPage";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") ?? "en";
  const date = url.searchParams.get("date") ?? undefined;
  const titleId = url.searchParams.get("titleId") ?? undefined;

  const data = await loadRemindersPage({
    userId: user?.id ?? null,
    searchParams: { date, titleId },
    locale,
  });

  return NextResponse.json(data);
}
