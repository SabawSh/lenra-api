import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { ensureDictionaryCoverageForLemmas } from "./ensureDictionaryCoverage.js";

type ExecuteCall = { sql: string; params: unknown[] };

function createMockConnection(state: {
  entries: Map<string, { senseCount: number; pending?: boolean }>;
  jobs: Set<string>;
}): PoolConnection {
  const calls: ExecuteCall[] = [];

  const conn = {
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      if (
        normalizedSql.includes("FROM dictionary_entries de") &&
        normalizedSql.includes("sense_count")
      ) {
        const lemma = String(params[0]);
        const entry = state.entries.get(lemma);
        if (!entry) {
          return [[], []];
        }
        const row = {
          id: `entry-${lemma}`,
          status: entry.pending ? "pending" : "ready",
          source: null,
          sense_count: entry.senseCount,
        } as RowDataPacket;
        return [[row], []];
      }

      if (normalizedSql.includes("FROM dictionary_generation_jobs")) {
        const lemma = String(params[0]);
        if (state.jobs.has(lemma)) {
          return [[{ id: "job-1" } as RowDataPacket], []];
        }
        return [[], []];
      }

      if (normalizedSql.includes("INSERT INTO dictionary_entries")) {
        const lemma = String(params[1]);
        if (!state.entries.has(lemma)) {
          state.entries.set(lemma, { senseCount: 0, pending: true });
        }
        return [{ affectedRows: 1 }, []];
      }

      if (normalizedSql.includes("INSERT INTO dictionary_generation_jobs")) {
        const lemma = String(params[1]);
        if (state.jobs.has(lemma)) {
          return [{ affectedRows: 0 }, []];
        }
        state.jobs.add(lemma);
        return [{ affectedRows: 1 }, []];
      }

      throw new Error(`Unexpected SQL in mock: ${normalizedSql}`);
    },
  } as unknown as PoolConnection;

  return conn;
}

describe("ensureDictionaryCoverageForLemmas", () => {
  it("skips lemmas that already have ready dictionary senses", async () => {
    const conn = createMockConnection({
      entries: new Map([["garden", { senseCount: 2 }]]),
      jobs: new Set(),
    });
    const result = await ensureDictionaryCoverageForLemmas(conn, ["garden"]);
    assert.equal(result.alreadyCovered, 1);
    assert.equal(result.generationJobsCreated, 0);
  });

  it("queues generation for missing lemmas", async () => {
    const state = {
      entries: new Map<string, { senseCount: number; pending?: boolean }>(),
      jobs: new Set<string>(),
    };
    const conn = createMockConnection(state);
    const result = await ensureDictionaryCoverageForLemmas(conn, ["slime"]);
    assert.equal(result.pendingEntriesEnsured, 1);
    assert.equal(result.generationJobsCreated, 1);
    assert.ok(state.jobs.has("slime"));
  });

  it("avoids duplicate generation jobs for the same lemma", async () => {
    const state = {
      entries: new Map([
        ["slime", { senseCount: 0, pending: true }],
      ]),
      jobs: new Set(["slime"]),
    };
    const conn = createMockConnection(state);
    const result = await ensureDictionaryCoverageForLemmas(conn, ["slime"]);
    assert.equal(result.generationJobsCreated, 0);
    assert.equal(result.duplicateJobsAvoided, 1);
  });
});
