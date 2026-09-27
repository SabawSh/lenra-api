/**
 * Backwards-compatible shim. Pages used to call `syncUser()` to make sure the
 * Clerk-side identity was mirrored into our DB on every visit. Now that we own
 * the auth, the DB row is created at sign-in time, so all this needs to do is
 * load the user and bump `last_active`.
 */
import { updateUserLastActiveNow } from "@/lib/db/queries/users";
import { readSessionFromCookies } from "./sessionCookie";

export async function syncUser() {
  const session = await readSessionFromCookies();
  if (!session) return null;

  return updateUserLastActiveNow(session.userId);
}
