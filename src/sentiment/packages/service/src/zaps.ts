/**
 * The default sentiment path: zaps and votes off the relays, no LLM.
 *
 * ## WHY THIS IS THE DEFAULT
 *
 * The LLM path (`analyze.ts`) fetches up to 100 notes and spends one model call
 * per note plus one for the synthesis. It is the richer answer and it takes
 * tens of seconds, sometimes minutes, and it can fail on a rate limit at the
 * worst possible moment. The product's actual claim — "the market decides" — is
 * already fully expressed by data that is on the relays as structured events:
 * NIP-88 poll responses, app-tagged opinion notes, and verified NIP-57 zap
 * receipts. Reading those is two relay round trips and some arithmetic.
 *
 * So this is what `GET /sentiment/:bip` serves. The LLM path stays reachable
 * and unbroken behind `?mode=llm` (or `SENTIMENT_MODE=llm`), and the payload
 * always states which one produced it. Nothing here ever falls back to the LLM,
 * and `analyze.ts` never falls back to here: a caller must be able to tell what
 * they got, and a silent substitution makes the response a guess.
 *
 * ## THE SCORE
 *
 * `score` is money-weighted: `(satsFor - satsAgainst) / (satsFor + satsAgainst)`
 * over VERIFIED zap receipts only, on -100..+100. Free votes are reported
 * alongside as counts, percentages and `voteScore`, because the divergence
 * between what people say and what people pay for is the thing worth looking
 * at. With no sats at all the gauge has no denominator, and the response says
 * `scoreBasis: "none"` rather than dressing a division guard up as consensus.
 *
 * ## FAILURE
 *
 * This function does not throw. Relay trouble degrades to zeros with
 * `degraded: true`; anything structural is caught and returns the same honest
 * empty payload. The demo cannot afford a 502, and a 502 would also be a lie —
 * "no data" is a real state of this system today.
 */
import { toZapSentimentData, type SentimentData, type ZapAudit } from "./adapter.js";
import type { ServiceConfig } from "./config.js";
import { emptySignals, fetchOpinionSignals, type OpinionSignals } from "./opinions.js";
import { safeMessage } from "./redact.js";

/**
 * Read the relays and produce the frontend payload. Never throws.
 *
 * Signature matches `loadSentimentData` so the two paths are interchangeable at
 * the routing layer and only there.
 */
export async function loadZapSentimentData(
  bipNumber: number,
  config: ServiceConfig,
): Promise<SentimentData> {
  const started = Date.now();
  let signals: OpinionSignals;

  try {
    signals = await fetchOpinionSignals(bipNumber, {
      relays: config.relays,
      limit: config.voteLimit,
      budgetMs: config.zapBudgetMs,
      zapTrust: config.zapTrust,
      lnurlTimeoutMs: config.lnurlTimeoutMs,
    });
  } catch (err) {
    console.warn(
      `zap sentiment degraded for BIP ${bipNumber}: ${safeMessage(err)}`,
    );
    signals = {
      ...emptySignals(bipNumber, { relays: config.relays, zapTrust: config.zapTrust }, true),
      elapsedMs: Date.now() - started,
    };
  }

  return toZapSentimentData({
    bipNumber,
    tally: signals.tally,
    freeCounts: signals.freeCounts,
    notes: signals.notes,
    // Built field by field rather than spread: `ZapVerification` also carries
    // the parsed `Opinion[]`, and those have no business in an HTTP response.
    zapAudit: toAudit(signals),
    degraded: signals.degraded,
    elapsedMs: signals.elapsedMs,
    relays: signals.relays,
    relaysAnswered: signals.relaysAnswered,
    now: Math.floor(Date.now() / 1000),
    recentNoteLimit: config.recentNoteLimit,
  });
}

function toAudit(signals: OpinionSignals): ZapAudit {
  return {
    trust: signals.zaps.trust,
    accepted: signals.zaps.accepted,
    rejected: signals.zaps.rejected,
    rejectedSats: signals.zaps.rejectedSats,
    skipped: signals.zaps.skipped,
  };
}
