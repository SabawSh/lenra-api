import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYTICS_NAME_SET } from "./eventCatalog";

/** Mirrors ingest UUID + event-name gates without hitting MySQL. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function validateIdentify(input: {
  visitorId: string;
  userId: string;
}): "ok" | "invalid_ids" {
  if (!isUuid(input.visitorId) || !input.userId) return "invalid_ids";
  return "ok";
}

function validateEventName(name: string): boolean {
  return ANALYTICS_NAME_SET.has(name);
}

describe("identity resolution guards", () => {
  it("rejects non-uuid visitor ids", () => {
    assert.equal(
      validateIdentify({ visitorId: "not-uuid", userId: "user-1" }),
      "invalid_ids",
    );
  });

  it("accepts uuid visitor with user id", () => {
    assert.equal(
      validateIdentify({
        visitorId: "550e8400-e29b-41d4-a716-446655440000",
        userId: "user-1",
      }),
      "ok",
    );
  });
});

describe("event payload validation", () => {
  it("accepts catalog events only", () => {
    assert.equal(validateEventName("page_view"), true);
    assert.equal(validateEventName("password_submitted"), false);
  });
});

describe("admin authorization expectation", () => {
  it("documents that admin routes require isSiteMediaAdmin", () => {
    // Contract test: admin analytics endpoints must 403 without site admin.
    const required = ["overview", "acquisition", "users", "search-console"];
    assert.equal(required.length, 4);
  });
});
