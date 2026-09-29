import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { POST as postJsonImport } from "../../api-routes/admin/content-import/json/route.js";
import { POST as postMultipartImport } from "../../api-routes/admin/content-import/route.js";
import { runWithApiRequest } from "../auth/apiRequestContext.js";
import { executeContentImport } from "../content-import/index.js";
import {
  parseJsonContentImportBody,
  parseMultipartContentImport,
} from "./contentImportRequest.js";

const ENV = { ...process.env };

export const MINIMAL_CLIPS_DOC = {
  clips: [
    {
      canonicalKey: "pipeline-test-key-001",
      text: "Hello from fixture.",
      metrics: {
        wordCount: 4,
        speechDurationMs: 1200,
        speechRate: 3.2,
      },
    },
  ],
};

async function invokeRoute(
  handler: (req: Request) => Promise<Response>,
  req: Request,
): Promise<Response> {
  return runWithApiRequest(req, () => handler(req));
}

function jsonRequest(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://127.0.0.1:4000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("parseJsonContentImportBody", () => {
  it("parses minimal JSON import request", () => {
    const parsed = parseJsonContentImportBody({
      episodeId: "446df68d-bd18-439b-90ff-d8eb7c5012d2",
      mode: "insert",
      artifacts: { clips: MINIMAL_CLIPS_DOC },
    });
    assert.equal(parsed.mode, "insert");
    assert.equal(parsed.confirmReplace, false);
    assert.deepEqual(parsed.artifacts.clips, MINIMAL_CLIPS_DOC);
  });

  it("rejects missing clips artifact", () => {
    assert.throws(
      () =>
        parseJsonContentImportBody({
          episodeId: "446df68d-bd18-439b-90ff-d8eb7c5012d2",
          artifacts: {},
        }),
      /clips\.json is required/,
    );
  });
});

describe("multipart vs JSON parsers", () => {
  it("produce the same artifact bundle for equivalent input", async () => {
    const episodeId = "446df68d-bd18-439b-90ff-d8eb7c5012d2";
    const jsonParsed = parseJsonContentImportBody({
      episodeId,
      mode: "replace",
      confirmReplace: true,
      artifacts: {
        clips: MINIMAL_CLIPS_DOC,
        translations: [{ canonicalKey: "pipeline-test-key-001", text: "fa" }],
      },
    });

    const form = new FormData();
    form.set("episodeId", episodeId);
    form.set("mode", "replace");
    form.set("confirmReplace", "true");
    form.set(
      "clips",
      new File([JSON.stringify(MINIMAL_CLIPS_DOC)], "clips.json", {
        type: "application/json",
      }),
    );
    form.set(
      "translations",
      new File(
        [JSON.stringify([{ canonicalKey: "pipeline-test-key-001", text: "fa" }])],
        "translations.json",
        { type: "application/json" },
      ),
    );

    const multipartParsed = await parseMultipartContentImport(form);

    assert.deepEqual(multipartParsed.episodeId, jsonParsed.episodeId);
    assert.equal(multipartParsed.mode, jsonParsed.mode);
    assert.equal(multipartParsed.confirmReplace, jsonParsed.confirmReplace);
    assert.deepEqual(multipartParsed.artifacts, jsonParsed.artifacts);
  });
});

describe("POST /api/admin/content-import/json auth", () => {
  beforeEach(() => {
    process.env = { ...ENV };
    process.env.CLOUD_UPLOAD_API_KEY = "test-upload-key";
  });

  afterEach(() => {
    process.env = ENV;
  });

  it("returns 401 without auth", async () => {
    const res = await invokeRoute(
      postJsonImport,
      jsonRequest("/api/admin/content-import/json?dryRun=1", {
        episodeId: "446df68d-bd18-439b-90ff-d8eb7c5012d2",
        artifacts: { clips: MINIMAL_CLIPS_DOC },
      }),
    );
    assert.equal(res.status, 401);
  });
});

describe("POST /api/admin/content-import multipart regression", () => {
  beforeEach(() => {
    process.env = { ...ENV };
    process.env.CLOUD_UPLOAD_API_KEY = "test-upload-key";
  });

  afterEach(() => {
    process.env = ENV;
  });

  it("rejects non-multipart content type", async () => {
    const res = await invokeRoute(
      postMultipartImport,
      jsonRequest(
        "/api/admin/content-import?dryRun=1",
        {
          episodeId: "x",
          artifacts: { clips: MINIMAL_CLIPS_DOC },
        },
        { authorization: "Bearer test-upload-key" },
      ),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /multipart\/form-data/i);
  });
});

describe("replace confirmReplace gate", () => {
  it("rejects replace without confirmReplace: true", async () => {
    await assert.rejects(
      () =>
        executeContentImport({
          episodeId: "446df68d-bd18-439b-90ff-d8eb7c5012d2",
          mode: "replace",
          confirmReplace: false,
          artifacts: { clips: MINIMAL_CLIPS_DOC },
        }),
      /confirmReplace: true/,
    );
  });
});

describe("JSON dry-run integration", () => {
  beforeEach(() => {
    process.env = { ...ENV };
  });

  afterEach(() => {
    process.env = ENV;
  });

  it("dry-run succeeds with bearer auth when DATABASE_URL and episode exist", async (t) => {
    const apiKey = process.env.CLOUD_UPLOAD_API_KEY?.trim();
    const episodeId = process.env.CONTENT_IMPORT_TEST_EPISODE_ID?.trim();
    if (!apiKey || !process.env.DATABASE_URL || !episodeId) {
      t.skip("needs CLOUD_UPLOAD_API_KEY, DATABASE_URL, CONTENT_IMPORT_TEST_EPISODE_ID");
      return;
    }

    const res = await invokeRoute(
      postJsonImport,
      jsonRequest(
        "/api/admin/content-import/json?dryRun=1",
        {
          episodeId,
          mode: "insert",
          artifacts: { clips: MINIMAL_CLIPS_DOC },
        },
        { authorization: `Bearer ${apiKey}` },
      ),
    );

    const body = (await res.json()) as { ok?: boolean; stage?: string };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.stage, "preview");
  });
});
