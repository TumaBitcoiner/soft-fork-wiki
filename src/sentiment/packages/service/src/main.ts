/**
 * Entrypoint.
 *   PORT=8002 SENTIMENT_PROVIDER=claude pnpm --filter @soft-fork-wiki/service dev
 *
 * Kept separate from server.ts so importing the server never has the side
 * effect of binding a port.
 */
import { loadConfig } from "./config.js";
import { createSentimentServer } from "./server.js";
import { safeMessage } from "./redact.js";

const config = loadConfig();
const server = createSentimentServer(config);

server.listen(config.port, () => {
  console.log(
    `sentiment service listening on http://localhost:${config.port}` +
      ` (provider: ${config.provider ?? "default"}, ttl: ${config.ttlMs}ms)`,
  );
  console.log(`  GET /sentiment/:bipNumber   GET /health`);
});

server.on("error", (err) => {
  console.error(`server error: ${safeMessage(err)}`);
  process.exitCode = 1;
});

// Ctrl-C during a demo should not leave the port bound.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
