import {
  GOOGLE_INTENT_COOKIE,
  GOOGLE_RETURN_COOKIE,
  clearGoogleOAuthCookiesOnResponse,
  exchangeGoogleCode,
  fetchGoogleProfile,
  getGoogleRedirectUri,
  oauthRedirect,
  resolveGoogleRedirectUriForCallback,
  verifySignedOAuthState,
  type GoogleOAuthIntent,
} from "@/lib/auth/google";
import {
  linkVerifiedPhoneToUser,
  loginOrRegisterViaGoogle,
  resolveUserIdFromGoogleSub,
} from "@/lib/auth/linking";
import {
  PENDING_PHONE_COOKIE,
  PENDING_PHONE_COOKIE_OPTIONS,
  verifyPendingPhoneToken,
} from "@/lib/auth/pendingVerification";
import { parseCookieHeader } from "@/lib/auth/readSessionFromRequest";
import { postAuthRedirectPath } from "@/lib/auth/postAuthRedirect";
import { setSessionForUserOnResponse } from "@/lib/auth/setSessionForUser";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const cookieJar = parseCookieHeader(req.headers.get("cookie") ?? "");
  const signed = stateParam ? verifySignedOAuthState(stateParam) : null;
  const requestedNext = signed?.next ?? cookieJar[GOOGLE_RETURN_COOKIE];
  const intent = (signed?.intent ?? cookieJar[GOOGLE_INTENT_COOKIE]) as
    | GoogleOAuthIntent
    | undefined;

  const failureRedirect = (reason: string) => {
    const res = NextResponse.redirect(
      oauthRedirect(req, `/sign-in?error=google_${reason}`),
    );
    clearGoogleOAuthCookiesOnResponse(res, req);
    return res;
  };
  const linkFailureRedirect = (code: string) => {
    const res = NextResponse.redirect(
      oauthRedirect(req, `/sign-in?error=link_${code}`),
    );
    clearGoogleOAuthCookiesOnResponse(res, req);
    return res;
  };

  if (errorParam) return failureRedirect(errorParam);
  if (!code || !stateParam) return failureRedirect("missing_params");
  if (!signed) return failureRedirect("bad_state");

  const redirectUri = resolveGoogleRedirectUriForCallback(req, signed);

  try {
    const tokens = await exchangeGoogleCode(code, req, redirectUri);
    const profile = await fetchGoogleProfile(tokens.access_token);
    if (!profile.sub) return failureRedirect("missing_sub");

    const now = new Date();

    if (intent === "link_phone") {
      const pendingRaw = cookieJar[PENDING_PHONE_COOKIE];

      const pending = pendingRaw
        ? await verifyPendingPhoneToken(pendingRaw)
        : null;
      if (!pending) {
        return linkFailureRedirect("pending_phone_expired");
      }

      const googleUserId = await resolveUserIdFromGoogleSub(profile.sub);
      let user;
      let isNewUser = false;

      if (googleUserId) {
        const linked = await linkVerifiedPhoneToUser(
          googleUserId,
          pending.phone,
          now,
        );
        if (!linked.ok) {
          return linkFailureRedirect(linked.code);
        }
        user = linked.user;
      } else {
        const registered = await loginOrRegisterViaGoogle({
          googleSub: profile.sub,
          email: profile.email ?? null,
          name: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
          emailVerifiedAt: profile.email_verified ? now : null,
          lastActive: now,
        });
        user = registered.user;
        isNewUser = registered.isNewUser;

        const linked = await linkVerifiedPhoneToUser(
          user.id,
          pending.phone,
          now,
        );
        if (!linked.ok) {
          return linkFailureRedirect(linked.code);
        }
        user = linked.user;
      }

      revalidateTag("user", { expire: 0 });

      const destination = postAuthRedirectPath(user, requestedNext, {
        pushPrompt: isNewUser,
      });
      const res = NextResponse.redirect(oauthRedirect(req, destination));
      clearGoogleOAuthCookiesOnResponse(res, req);
      res.cookies.set(PENDING_PHONE_COOKIE, "", {
        ...PENDING_PHONE_COOKIE_OPTIONS,
        maxAge: 0,
      });
      await setSessionForUserOnResponse(res, user);
      return res;
    }

    if (intent === "link_google_settings") {
      const sessionModule = await import("@/lib/auth/sessionCookie");
      const session = await sessionModule.readSessionFromCookies();
      if (!session) return failureRedirect("not_signed_in");

      const { linkGoogleToUser } = await import("@/lib/auth/linking");
      const linked = await linkGoogleToUser(session.userId, {
        googleSub: profile.sub,
        email: profile.email ?? null,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
        emailVerifiedAt: profile.email_verified ? now : null,
        verifiedAt: now,
      });
      if (!linked.ok) {
        const res = NextResponse.redirect(
          oauthRedirect(
            req,
            `/dashboard/settings?panel=login&error=${linked.code}`,
          ),
        );
        clearGoogleOAuthCookiesOnResponse(res, req);
        return res;
      }

      revalidateTag("user", { expire: 0 });
      const res = NextResponse.redirect(
        oauthRedirect(req, "/dashboard/settings?panel=login&linked=google"),
      );
      clearGoogleOAuthCookiesOnResponse(res, req);
      return res;
    }

    const { user, isNewUser } = await loginOrRegisterViaGoogle({
      googleSub: profile.sub,
      email: profile.email ?? null,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
      emailVerifiedAt: profile.email_verified ? now : null,
      lastActive: now,
    });

    revalidateTag("user", { expire: 0 });

    const destination = postAuthRedirectPath(user, requestedNext, {
      pushPrompt: isNewUser,
    });
    const res = NextResponse.redirect(oauthRedirect(req, destination));
    clearGoogleOAuthCookiesOnResponse(res, req);
    await setSessionForUserOnResponse(res, user);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google callback]", message, err);

    if (message.includes("Google token exchange failed")) {
      console.error("[google callback] redirect_uri used:", redirectUri);
      const lower = message.toLowerCase();
      if (lower.includes("redirect_uri_mismatch")) {
        return failureRedirect("redirect_uri");
      }
      if (lower.includes("invalid_client")) {
        return failureRedirect("invalid_client");
      }
      if (lower.includes("invalid_grant")) {
        return failureRedirect("expired_code");
      }
      return failureRedirect("token");
    }
    if (
      message.includes("ECONNREFUSED") ||
      message.includes("ER_ACCESS_DENIED") ||
      message.includes("connect")
    ) {
      console.error("[google callback] database or upstream failure");
    }
    if (message.includes("Google userinfo failed")) {
      return failureRedirect("profile");
    }
    return failureRedirect("exception");
  }
}
