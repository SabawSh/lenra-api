import type { User } from "@/lib/db/queries/users";
import { legalVersionForSession } from "@/lib/legal/sessionLegalVersion";
import type { UserLegalSlice } from "@/lib/legal/types";
import type { NextResponse } from "next/server";
import { setSessionCookie, setSessionCookieOnResponse } from "./sessionCookie";
import type { SessionPayload } from "./session";

type SessionUser = Pick<User, "id"> & UserLegalSlice;

function sessionPayloadForUser(user: SessionUser): SessionPayload {
  const lv = legalVersionForSession(user);
  return {
    userId: user.id,
    ...(lv ? { lv } : {}),
  };
}

/** Issue a session cookie, embedding legal version when the user is compliant. */
export async function setSessionForUser(user: SessionUser): Promise<void> {
  await setSessionCookie(sessionPayloadForUser(user));
}

/** Session on a redirect response so the browser receives Set-Cookie on 302. */
export async function setSessionForUserOnResponse(
  response: NextResponse,
  user: SessionUser,
): Promise<void> {
  await setSessionCookieOnResponse(response, sessionPayloadForUser(user));
}
