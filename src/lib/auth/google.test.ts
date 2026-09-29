import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  createSignedOAuthState,
  getGoogleRedirectUri,
  sanitizeOAuthNext,
  verifySignedOAuthState,
} from "./google.js";

const ENV = { ...process.env };

describe("Google OAuth redirect URI", () => {
  beforeEach(() => {
    process.env = { ...ENV };
    process.env.AUTH_SECRET = "x".repeat(48);
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env = ENV;
  });

  it("uses localhost callback in dev when env points at production", () => {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_BASE_URL = "https://lenra.ir";
    const req = new Request("http://127.0.0.1:4000/api/auth/google/start", {
      headers: { host: "127.0.0.1:4000" },
    });
    assert.equal(
      getGoogleRedirectUri(req),
      "http://127.0.0.1:4000/api/auth/google/callback",
    );
  });

  it("uses production https callback when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://lenra.ir";
    const req = new Request("http://internal:4000/api/auth/google/start", {
      headers: {
        "x-forwarded-host": "lenra.ir",
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(
      getGoogleRedirectUri(req),
      "https://lenra.ir/api/auth/google/callback",
    );
  });

  it("pins redirect_uri in signed state for callback token exchange", () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_REDIRECT_URI =
      "https://lenra.ir/api/auth/google/callback";
    const redirectUri = "https://lenra.ir/api/auth/google/callback";
    const state = createSignedOAuthState({ redirectUri });
    const verified = verifySignedOAuthState(state);
    assert.equal(verified?.redirectUri, redirectUri);
  });
});

describe("sanitizeOAuthNext", () => {
  it("allows relative in-app paths only", () => {
    assert.equal(sanitizeOAuthNext("/dashboard"), "/dashboard");
    assert.equal(sanitizeOAuthNext("//evil.com"), "/");
    assert.equal(sanitizeOAuthNext("https://evil.com"), "/");
    assert.equal(sanitizeOAuthNext(null), "/");
  });
});
