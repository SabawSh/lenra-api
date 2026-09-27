import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import { listUsersForAdmin } from "@/lib/db/queries/users";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await listUsersForAdmin({ limit: 100 });
  const initialUsers = rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    phone: row.phone,
  }));
  return NextResponse.json({ initialUsers });
}
