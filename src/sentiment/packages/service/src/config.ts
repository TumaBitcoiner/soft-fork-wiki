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
import type { ProviderName } from "@soft-fork-wiki/sentiment";

export interface ServiceConfig {
  /** TCP port to listen on. 8000/8001 belong to the Python backends. */
  port: number;
  /** How long a computed SentimentData stays fresh, in milliseconds. */
  ttlMs: number;
  /** Max Nostr notes pulled per analysis (each one costs an LLM call). */
  noteLimit: number;
  /** How many notes to surface in `recentNotes`. */
  recentNoteLimit: number;
  /** Classifier backend. Undefined lets the sentiment package pick its default. */
  provider?: ProviderName;
  /** Relay override. Undefined falls back to DEFAULT_RELAYS from shared. */
  relays?: string[];
}

const DEFAULT_PORT = 8002;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_NOTE_LIMIT = 100;
const DEFAULT_RECENT_NOTES = 8;

const PROVIDERS: readonly ProviderName[] = ["claude", "gemini"];

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
    ttlMs: readInt("SENTIMENT_TTL_MS", DEFAULT_TTL_MS, 0, 24 * 60 * 60 * 1000),
    noteLimit: readInt("SENTIMENT_NOTE_LIMIT", DEFAULT_NOTE_LIMIT, 1, 500),
    recentNoteLimit: readInt("SENTIMENT_RECENT_NOTES", DEFAULT_RECENT_NOTES, 0, 50),
    provider: readProvider(),
    relays: readRelays(),
  };
}
