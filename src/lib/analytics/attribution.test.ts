import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAcquisitionChannel,
  parseUtmFromSearch,
  referrerDomain,
} from "./attribution";
import { ANALYTICS_NAME_SET, EVENT_CATEGORY_BY_NAME } from "./eventCatalog";
import { consumeRateLimit } from "./rateLimit";

describe("classifyAcquisitionChannel", () => {
  it("classifies paid search from utm medium", () => {
    assert.equal(
      classifyAcquisitionChannel({
        utm: { medium: "cpc", source: "google" },
      }),
      "paid_search",
    );
  });

  it("preserves organic search from google referrer", () => {
    assert.equal(
      classifyAcquisitionChannel({
        referrerUrl: "https://www.google.com/search?q=lenra",
      }),
      "organic_search",
    );
  });

  it("returns direct when no referrer or utm", () => {
    assert.equal(classifyAcquisitionChannel({}), "direct");
  });

  it("classifies social referrers", () => {
    assert.equal(
      classifyAcquisitionChannel({
        referrerUrl: "https://t.me/share",
      }),
      "social",
    );
  });

  it("classifies email campaigns", () => {
    assert.equal(
      classifyAcquisitionChannel({ utm: { medium: "email" } }),
      "email",
    );
  });
});

describe("parseUtmFromSearch", () => {
  it("parses all utm params", () => {
    const utm = parseUtmFromSearch(
      "?utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=banner&utm_term=learn",
    );
    assert.deepEqual(utm, {
      source: "newsletter",
      medium: "email",
      campaign: "spring",
      content: "banner",
      term: "learn",
    });
  });
});

describe("referrerDomain", () => {
  it("extracts hostname", () => {
    assert.equal(referrerDomain("https://blog.example.com/a"), "blog.example.com");
  });

  it("returns null for invalid urls", () => {
    assert.equal(referrerDomain("not-a-url"), null);
  });
});

describe("event catalog", () => {
  it("maps every event name to a category", () => {
    for (const name of ANALYTICS_NAME_SET) {
      assert.ok(name in EVENT_CATEGORY_BY_NAME);
    }
  });
});

describe("rateLimit", () => {
  it("allows then blocks after threshold", () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      assert.equal(consumeRateLimit(key, 3, 60_000).allowed, true);
    }
    assert.equal(consumeRateLimit(key, 3, 60_000).allowed, false);
  });
});
