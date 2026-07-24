/**
 * Runtime configuration, read once at startup.
 *
 * Every knob is an env var so the same build can be pointed at a different
 * provider, relay set, or cache window without a code change.
 *
 * API keys are deliberately NOT read here. Each classifier reads its own key
 * straight out of `process.env` when it is constructed, so no secret ever lands
 * in a config object that we might log, serialise into /health, or attach to an
 * error response.
 */
import type { ProviderName, ZapTrust } from "@soft-fork-wiki/sentiment";
import type { SentimentMode } from "./adapter.js";
import { DEFAULT_BUDGET_MS } from "./opinions.js";

export interface ServiceConfig {
  /** TCP port to listen on. 8000/8001 belong to the Python backends. */
  port: number;
  /**
   * Default pipeline for `GET /sentiment/:bip`. `zaps` unless told otherwise —
   * see `zaps.ts` for why. A request can override it with `?mode=`.
   */
  mode: SentimentMode;
  /** How long an LLM-mode result stays fresh, in milliseconds. */
  ttlMs: number;
  /**
   * How long a zap-mode result stays fresh. SECONDS, not minutes: somebody will
   * zap on stage and expect the needle to move before they finish the sentence.
   */
  zapTtlMs: number;
  /**
   * Wall-clock ceiling on the APP-VOTE relay reads behind one zap-mode
   * response. This is the number that keeps that half fast when a relay wedges.
   */
  zapBudgetMs: number;
  /**
   * Zap receipt validation policy. `"lnurl"` (the default) is the only one that
   * resists forgery, and sats are the score — see `zaptrust.ts`. The unsafe
   * modes exist for offline fixtures, not for going faster.
   */
  zapTrust: ZapTrust;
  /** Per-request budget for one LNURL-pay endpoint lookup, in milliseconds. */
  lnurlTimeoutMs: number;
  /** Max vote/zap events pulled per kind in zap mode. */
  voteLimit: number;
  /** Max Nostr notes pulled per LLM analysis (each one costs an LLM call). */
  noteLimit: number;
  /**
   * Max PUBLIC posts about a BIP that the discussion read will measure.
   *
   * This is the cap that stops a busy proposal from blowing the budget: every
   * post costs relay traffic in `fetchEngagement`, and a BIP with thousands of
   * posts would otherwise scale the request linearly. Truncation is reported in
   * the payload (`discussionZaps.truncated` / `postsDropped`), never silent.
   */
  discussionPostLimit: number;
  /** Wall-clock ceiling on the whole public-discussion read, in milliseconds. */
  discussionBudgetMs: number;
  /** How long a public-discussion read is reused, in milliseconds. */
  discussionTtlMs: number;
  /** How many notes to surface in `recentNotes`. */
  recentNoteLimit: number;
  /** Classifier backend. Undefined lets the sentiment package pick its default. */
  provider?: ProviderName;
  /** Relay override. Undefined falls back to DEFAULT_RELAYS from shared. */
  relays?: string[];
}

const DEFAULT_PORT = 8002;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
/** Five seconds: long enough to absorb a burst of tabs, short enough to feel live. */
const DEFAULT_ZAP_TTL_MS = 5_000;
/** One source of truth for the relay budget; the measurements are on it. */
const DEFAULT_ZAP_BUDGET_MS = DEFAULT_BUDGET_MS;
const DEFAULT_LNURL_TIMEOUT_MS = 2_500;
const DEFAULT_VOTE_LIMIT = 500;
const DEFAULT_NOTE_LIMIT = 100;

/**
 * MEASURED, and the number matters more than it looks.
 *
 * `fetch.ts` sorts discovered posts NEWEST FIRST and then applies this cap, so
 * the cap does not trim noise — it trims history. Zaps accumulate on posts over
 * time, so the richest posts are usually the oldest ones in the window, and a
 * tight cap throws exactly them away. At 200 the same BIP 300 read returned
 * 3,956 sats on one request and 64 on the next, purely because 99-114 candidates
 * fell off the end and which ones varied with relay timing. At 300 the same read
 * discards ~16 and is stable.
 *
 * The cost is real and bounded: every post is relay traffic in `fetchEngagement`,
 * and 300 posts is ~9.5s cold / ~4.7s warm for that pass. The discussion cache
 * means a demo pays it once per BIP per five minutes. Truncation is still
 * reported (`discussionZaps.truncated` / `postsDropped`) so raising or lowering
 * this is a visible decision rather than a silent one.
 */
const DEFAULT_DISCUSSION_POSTS = 300;

/**
 * MEASURED. Discovery lands ~8s (bounded by its own filter timeout, all lanes in
 * parallel — shorter timeouts measurably lost whole relays: BIP 352 came back
 * with 9 posts at 4s and 149 at 8s) and the engagement read ~5s warm, ~9.5s cold
 * on the LNURL lookups. 20s covers a cold run with headroom; the budget is a
 * ceiling that degrades to zeros, not a target, and `lnurlcache.ts` plus the
 * discussion cache are what keep the common case two orders of magnitude below
 * it.
 */
const DEFAULT_DISCUSSION_BUDGET_MS = 20_000;

/**
 * Five minutes. Deliberately much longer than `zapTtlMs`: the two halves of the
 * response refresh on different clocks. Somebody zapping in the app must see the
 * needle move within seconds (that is `zapTtlMs`), while the public conversation
 * about a BIP does not change meaningfully inside five minutes and re-reading it
 * costs eight relay filters plus an engagement pass.
 */
const DEFAULT_DISCUSSION_TTL_MS = 5 * 60 * 1000;

const DEFAULT_RECENT_NOTES = 8;

const PROVIDERS: readonly ProviderName[] = ["claude", "gemini"];
const MODES: readonly SentimentMode[] = ["zaps", "llm"];
const ZAP_TRUSTS: readonly ZapTrust[] = ["lnurl", "structural", "none"];

/**
 * Parse a positive integer env var, falling back when unset/blank.
 *
 * We throw rather than silently defaulting on a malformed value: a typo in
 * `PORT` should fail loudly at boot, not quietly serve on the wrong port.
 */
function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max} (got "${raw}")`,
    );
  }
  return value;
}

function readProvider(): ProviderName | undefined {
  const raw = process.env.SENTIMENT_PROVIDER?.trim();
  if (!raw) return undefined;
  if (!PROVIDERS.includes(raw as ProviderName)) {
    throw new Error(
      `SENTIMENT_PROVIDER must be one of ${PROVIDERS.join(" | ")} (got "${raw}")`,
    );
  }
  return raw as ProviderName;
}

/**
 * Parse a mode string. Exported because the route parses `?mode=` with exactly
 * the same rules, and two spellings of "which pipeline" is how a service starts
 * lying about what produced a response.
 */
export function parseMode(raw: string | null | undefined): SentimentMode | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  // "zap" reads more naturally in a URL than "zaps"; accept both rather than
  // 400 someone mid-demo over a plural.
  if (value === "zap") return "zaps";
  return MODES.includes(value as SentimentMode) ? (value as SentimentMode) : null;
}

function readMode(): SentimentMode {
  const raw = process.env.SENTIMENT_MODE?.trim();
  if (!raw) return "zaps";
  const mode = parseMode(raw);
  if (!mode) {
    throw new Error(
      `SENTIMENT_MODE must be one of ${MODES.join(" | ")} (got "${raw}")`,
    );
  }
  return mode;
}

function readZapTrust(): ZapTrust {
  const raw = process.env.SENTIMENT_ZAP_TRUST?.trim();
  if (!raw) return "lnurl";
  if (!ZAP_TRUSTS.includes(raw as ZapTrust)) {
    throw new Error(
      `SENTIMENT_ZAP_TRUST must be one of ${ZAP_TRUSTS.join(" | ")} (got "${raw}")`,
    );
  }
  return raw as ZapTrust;
}

function readRelays(): string[] | undefined {
  const raw = process.env.SENTIMENT_RELAYS?.trim();
  if (!raw) return undefined;
  const relays = raw
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return relays.length > 0 ? relays : undefined;
}

/** Build the config from the current environment. Throws on bad input. */
export function loadConfig(): ServiceConfig {
  return {
    // 0 is allowed on purpose: it means "any free port", which is how a test
    // binds this server without fighting the dev instance for 8002.
    port: readInt("PORT", DEFAULT_PORT, 0, 65_535),
    mode: readMode(),
    ttlMs: readInt("SENTIMENT_TTL_MS", DEFAULT_TTL_MS, 0, 24 * 60 * 60 * 1000),
    // Capped at five minutes: a longer "live" TTL is a bug, not a config.
    zapTtlMs: readInt("SENTIMENT_ZAP_TTL_MS", DEFAULT_ZAP_TTL_MS, 0, 5 * 60 * 1000),
    zapBudgetMs: readInt("SENTIMENT_ZAP_BUDGET_MS", DEFAULT_ZAP_BUDGET_MS, 200, 30_000),
    zapTrust: readZapTrust(),
    lnurlTimeoutMs: readInt(
      "SENTIMENT_LNURL_TIMEOUT_MS",
      DEFAULT_LNURL_TIMEOUT_MS,
      200,
      30_000,
    ),
    voteLimit: readInt("SENTIMENT_VOTE_LIMIT", DEFAULT_VOTE_LIMIT, 1, 2_000),
    noteLimit: readInt("SENTIMENT_NOTE_LIMIT", DEFAULT_NOTE_LIMIT, 1, 500),
    discussionPostLimit: readInt(
      "SENTIMENT_DISCUSSION_POSTS",
      DEFAULT_DISCUSSION_POSTS,
      1,
      500,
    ),
    discussionBudgetMs: readInt(
      "SENTIMENT_DISCUSSION_BUDGET_MS",
      DEFAULT_DISCUSSION_BUDGET_MS,
      1_000,
      60_000,
    ),
    // 0 disables the discussion cache entirely, which is a legitimate thing to
    // want while measuring cold timings.
    discussionTtlMs: readInt(
      "SENTIMENT_DISCUSSION_TTL_MS",
      DEFAULT_DISCUSSION_TTL_MS,
      0,
      60 * 60 * 1000,
    ),
    recentNoteLimit: readInt("SENTIMENT_RECENT_NOTES", DEFAULT_RECENT_NOTES, 0, 50),
    provider: readProvider(),
    relays: readRelays(),
  };
}
