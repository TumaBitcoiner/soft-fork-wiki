import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { SentimentData } from "./adapter.js";
import { loadSentimentData } from "./analyze.js";
import type { ServiceConfig } from "./config.js";
import { createSentimentServer, type ServerDeps } from "./server.js";

function serviceConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    port: 0,
    mode: "llm",
    ttlMs: 60_000,
    zapTtlMs: 5_000,
    zapBudgetMs: 1_500,
    zapTrust: "lnurl",
    lnurlTimeoutMs: 2_500,
    voteLimit: 500,
    noteLimit: 100,
    discussionPostLimit: 300,
    discussionBudgetMs: 20_000,
    discussionTtlMs: 300_000,
    recentNoteLimit: 8,
    snapshotFirst: true,
    ...overrides,
  };
}

function sentimentData(bipNumber: number): SentimentData {
  return {
    bipNumber,
    against: 20,
    neutral: 30,
    for: 50,
    totalVotes: 0,
    totalSats: 0,
    score: 30,
    recentNotes: [],
    mode: "llm",
    scoreBasis: "notes",
    hasSignal: true,
    hasDirection: true,
    directionNote: "Direction comes from classified posts.",
    satsScore: null,
    voteScore: 20,
    degraded: false,
    totalSatsFor: 0,
    totalSatsAgainst: 0,
    counts: { favour: 5, against: 2, neutral: 3 },
    sampleSize: 10,
    uniqueVoters: 0,
    narrative: "",
    computedAt: 1_784_903_583,
  };
}

async function withServer(
  deps: ServerDeps,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createSentimentServer(serviceConfig(), deps);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("serves bundled snapshots without an LLM key", async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const result = await loadSentimentData(110, serviceConfig());
    assert.equal(result.bipNumber, 110);
    assert.equal(result.sampleSize, 118);
    assert.equal(result.snapshot, true);
  } finally {
    if (previousGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiKey;
    }
  }
});

test("deduplicates concurrent loads, caches results, and refreshes explicitly", async () => {
  let calls = 0;
  const load = async (bipNumber: number): Promise<SentimentData> => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return sentimentData(bipNumber);
  };

  await withServer({ load }, async (origin) => {
    const endpoint = `${origin}/sentiment/999?mode=llm`;
    const [first, second] = await Promise.all([fetch(endpoint), fetch(endpoint)]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 1);

    assert.equal((await fetch(endpoint)).status, 200);
    assert.equal(calls, 1);

    assert.equal((await fetch(`${endpoint}&refresh=1`)).status, 200);
    assert.equal(calls, 2);
  });
});

test("rejects malformed BIP numbers and reports upstream LLM failures", async () => {
  await withServer({
    load: async () => {
      throw new Error("GEMINI_API_KEY is required.");
    },
  }, async (origin) => {
    const invalid = await fetch(`${origin}/sentiment/not-a-bip?mode=llm`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as { error: string }).error, "invalid_bip_number");

    const failed = await fetch(`${origin}/sentiment/999?mode=llm`);
    assert.equal(failed.status, 502);
    const body = await failed.json() as { error: string; message: string };
    assert.equal(body.error, "sentiment_unavailable");
    assert.match(body.message, /GEMINI_API_KEY is required/);
  });
});
