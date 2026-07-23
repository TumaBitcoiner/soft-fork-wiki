/**
 * Scrub credentials out of anything we are about to log or return.
 *
 * Upstream SDK errors are chatty and have been known to echo request headers,
 * so an unmodified `err.message` is not safe to hand to a browser. Two passes:
 * exact matches of the key values we know are in the environment, then a
 * pattern sweep for common key formats in case a key reached us some other way
 * (a URL query string, a nested cause).
 *
 * Fail closed: if in doubt, redact.
 */

/** Env vars whose *values* must never appear in a response or a log line. */
const SECRET_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "NOSTR_SECRET_KEY",
];

/** Shapes of well-known API keys: Anthropic `sk-…`, Google `AIza…`, bearer tokens. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /AIza[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
];

/** Never echo an unbounded upstream error body back to a caller. */
const MAX_MESSAGE_CHARS = 300;

export const REDACTED = "[redacted]";

/** Remove any credential-looking substring from `text`. */
export function redact(text: string): string {
  let out = text;

  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    // Short values would match far too much ordinary text.
    if (value && value.length >= 8) out = out.split(value).join(REDACTED);
  }

  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }

  return out;
}

/** Turn an unknown thrown value into a short, credential-free message. */
export function safeMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  const cleaned = redact(raw).replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_MESSAGE_CHARS
    ? `${cleaned.slice(0, MAX_MESSAGE_CHARS - 1)}…`
    : cleaned;
}
