/**
 * Entrypoint.
 *   PORT=8002 pnpm --filter @soft-fork-wiki/service dev
 *
 * Kept separate from server.ts so importing the server never has the side
 * effect of binding a port.
 *
 * Two things happen here that do not happen in `createSentimentServer`, both
 * because they are process-level rather than request-level: the relay sockets
 * are opened before the first request (so the demo's first read is a warm one
 * rather than the one that pays for four TLS handshakes), and they are closed
 * on the way out.
 */
import { loadConfig } from "./config.js";
import { createSentimentServer } from "./server.js";
import { safeMessage } from "./redact.js";
import { closeRelayPool, warmRelays } from "./relays.js";

const config = loadConfig();
const server = createSentimentServer(config);

server.listen(config.port, () => {
  console.log(
    `sentiment service listening on http://localhost:${config.port}` +
      ` (mode: ${config.mode}, provider: ${config.provider ?? "default"})`,
  );
  console.log(
    `  ttl: zaps ${config.zapTtlMs}ms / llm ${config.ttlMs}ms;` +
      ` relay budget ${config.zapBudgetMs}ms; zap trust ${config.zapTrust}`,
  );
  console.log(
    `  GET /sentiment/:bipNumber[?mode=zaps|llm][&refresh=1]   GET /health`,
  );

  // Fire and forget: the server is already accepting connections, and a relay
  // that is down right now may be up by the first request.
  void warmRelays(config.relays).then((connected) => {
    console.log(`  relays warm: ${connected.length ? connected.join(", ") : "none"}`);
  });
});

server.on("error", (err) => {
  console.error(`server error: ${safeMessage(err)}`);
  process.exitCode = 1;
});

// Ctrl-C during a demo should not leave the port bound.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    closeRelayPool();
    server.close(() => process.exit(0));
  });
}
