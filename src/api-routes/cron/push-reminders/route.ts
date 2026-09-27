import { runPushReminderScheduler } from "@/lib/push/server/scheduler";
import { NextResponse } from "next/server";

function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === "development";

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPushReminderScheduler();
  return NextResponse.json({ ok: true, result });
}

export async function POST(req: Request) {
  return GET(req);
}
