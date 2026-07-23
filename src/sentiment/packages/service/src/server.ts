/**
 * The HTTP surface: `GET /sentiment/:bipNumber` and `GET /health`.
 *
 * `node:http` only — no framework. The routing table is two entries, and one
 * fewer thing to install is one fewer thing to break before a demo.
 *
 * CORS is fully permissive because the only thing here is public, read-only
 * data about public Nostr discussion, and the Vite dev server sits on a
 * different port (5173) than this service (8002). There is nothing to protect
 * with an origin check, and a narrow allowlist would just break the next person
 * who runs the frontend somewhere else.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { SentimentData } from "./adapter.js";
import { loadSentimentData } from "./analyze.js";
import { SingleFlightCache } from "./cache.js";
import type { ServiceConfig } from "./config.js";
import { safeMessage } from "./redact.js";

/** `/sentiment/110` — the BIP number is the only path parameter we take. */
const SENTIMENT_ROUTE = /^\/sentiment\/([^/]+)$/;

/** Max plausible BIP number. Guards against `/sentiment/99999999999999`. */
const MAX_BIP_NUMBER = 999_999;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export interface ServerDeps {
  /**
   * Analysis function, injectable so the server can be exercised without an
   * API key or a relay connection. Defaults to the real LLM-backed loader.
   */
  load?: (bipNumber: number, config: ServiceConfig) => Promise<SentimentData>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  sendJson(res, status, { error, message, ...extra });
}

/**
 * Parse the BIP number out of a path segment.
 *
 * Strict digits only: `Number("110abc")` is NaN but `Number(" 110 ")` is 110,
 * and we do not want whitespace-padded ids silently sharing a cache entry with
 * the clean ones.
 */
function parseBipNumber(segment: string): number | null {
  const decoded = decodeURIComponent(segment);
  if (!/^\d{1,7}$/.test(decoded)) return null;
  const value = Number(decoded);
  if (value < 1 || value > MAX_BIP_NUMBER) return null;
  return value;
}

function wantsRefresh(url: URL): boolean {
  const raw = url.searchParams.get("refresh");
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Build the server. Call `.listen(port)` yourself — keeping construction and
 * binding separate is what makes this testable on an ephemeral port.
 */
export function createSentimentServer(
  config: ServiceConfig,
  deps: ServerDeps = {},
): Server {
  const load = deps.load ?? loadSentimentData;
  const cache = new SingleFlightCache<number, SentimentData>(config.ttlMs);
  const startedAt = Date.now();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    // The base is a throwaway: we only ever read pathname/searchParams, and
    // `req.url` on a server is always origin-relative.
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD, OPTIONS");
      sendError(res, 405, "method_not_allowed", `${method} is not supported.`);
      return;
    }

    if (path === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "@soft-fork-wiki/service",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        // The provider *name* is safe to expose; its API key is never read here.
        provider: config.provider ?? "default",
        ttlMs: config.ttlMs,
        cache: cache.stats(),
      });
      return;
    }

    const match = SENTIMENT_ROUTE.exec(path);
    if (!match) {
      sendError(
        res,
        404,
        "not_found",
        `No route for ${path}. Try GET /sentiment/:bipNumber or GET /health.`,
      );
      return;
    }

    const bipNumber = parseBipNumber(match[1] ?? "");
    if (bipNumber === null) {
      sendError(
        res,
        400,
        "invalid_bip_number",
        "bipNumber must be a positive integer, e.g. /sentiment/110.",
      );
      return;
    }

    if (wantsRefresh(url)) cache.invalidate(bipNumber);

    try {
      const data = await cache.get(bipNumber, () => load(bipNumber, config));
      sendJson(res, 200, data);
    } catch (err) {
      // Upstream = relays or the LLM provider. Neither is the caller's fault,
      // so this is a 502, and the message goes through the redactor before it
      // reaches either the log or the wire.
      const message = safeMessage(err);
      console.error(`sentiment analysis failed for BIP ${bipNumber}: ${message}`);
      sendError(res, 502, "sentiment_unavailable", message, { bipNumber });
    }
  }

  return createHttpServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const message = safeMessage(err);
      console.error(`unhandled request error: ${message}`);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", message);
      } else {
        res.end();
      }
    });
  });
}
