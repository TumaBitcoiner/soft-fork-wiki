/**
 * The default sentiment path: real money off the relays, no LLM.
 *
 * ## WHY THIS IS THE DEFAULT
 *
 * The LLM path (`analyze.ts`) fetches up to 100 notes and spends one model call
 * per note plus one for the synthesis. It is the richer answer and it takes
 * tens of seconds, sometimes minutes, and it can fail on a rate limit at the
 * worst possible moment. The product's actual claim — "the market decides" — is
 * already expressed by data that is on the relays as structured events, and
 * reading those is a handful of relay round trips and some arithmetic.
 *
 * So this is what `GET /sentiment/:bip` serves. The LLM path stays reachable
 * and unbroken behind `?mode=llm` (or `SENTIMENT_MODE=llm`), and the payload
 * always states which one produced it. Nothing here ever falls back to the LLM,
 * and `analyze.ts` never falls back to here: a caller must be able to tell what
 * they got, and a silent substitution makes the response a guess.
 *
 * ## TWO READS, TWO ANSWERS, ONE PAYLOAD
 *
 * This route used to read one thing: events carrying our own `softforkwiki`
 * tag. That is the correct definition of "a vote cast in this app" — and it is
 * zero for every BIP, because nobody has used the app yet. Meanwhile tens of
 * thousands of sats sit on public Nostr posts arguing about those same BIPs.
 * Reporting zero was accurate about the app and wrong about the world.
 *
 * So the route now runs BOTH reads, in parallel, and reports them SEPARATELY:
 *
 *  - `discussion.ts` finds public posts about the BIP and asks the relays what
 *    the network paid for them. That lands in `discussionZaps`: real sats, real
 *    zappers, verified. It is a MAGNITUDE and carries no direction.
 *  - `opinions.ts` reads the app's own poll responses, opinion notes and
 *    anchored zaps. That lands in `appVotes`, still zero today, and is the only
 *    half that can point the needle.
 *
 * They are never added together except in `totalSats`, which says so. See
 * `adapter.ts` for the full contract and for why `scoreBasis: "magnitude"`
 * exists.
 *
 * Running them concurrently rather than in sequence matters: the app read is
 * bounded by `zapBudgetMs` (~1.5s) and the discussion read by
 * `discussionBudgetMs` (seconds), and stacking them would add up to the slower
 * one plus the faster one for no reason.
 *
 * ## FAILURE
 *
 * This function does not throw. Either read can degrade to zeros on its own
 * without taking the other down, and anything structural is caught and returns
 * the same honest empty payload. The demo cannot afford a 502, and a 502 would
 * also be a lie — "no data" is a real state of this system today.
 */
import { toZapSentimentData, type SentimentData, type ZapAudit } from "./adapter.js";
import type { ServiceConfig } from "./config.js";
import {
  emptyDiscussion,
  loadDiscussionSignals,
  type DiscussionOptions,
  type DiscussionSignals,
} from "./discussion.js";
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
  const discussionOpts = toDiscussionOptions(config);

  // Both reads promise not to throw, and both are caught anyway: one of them
  // blowing up must cost its own half of the payload, not the whole response.
  const [signals, discussion] = await Promise.all([
    fetchOpinionSignals(bipNumber, {
      relays: config.relays,
      limit: config.voteLimit,
      budgetMs: config.zapBudgetMs,
      zapTrust: config.zapTrust,
      lnurlTimeoutMs: config.lnurlTimeoutMs,
    }).catch((err: unknown): OpinionSignals => {
      console.warn(
        `app vote signals degraded for BIP ${bipNumber}: ${safeMessage(err)}`,
      );
      return {
        ...emptySignals(bipNumber, { relays: config.relays, zapTrust: config.zapTrust }, true),
        elapsedMs: Date.now() - started,
      };
    }),
    loadDiscussionSignals(bipNumber, discussionOpts).catch(
      (err: unknown): DiscussionSignals => {
        console.warn(
          `discussion signals degraded for BIP ${bipNumber}: ${safeMessage(err)}`,
        );
        return emptyDiscussion(discussionOpts, true);
      },
    ),
  ]);

  return toZapSentimentData({
    bipNumber,
    tally: signals.tally,
    freeCounts: signals.freeCounts,
    notes: signals.notes,
    // Built field by field rather than spread: `ZapVerification` also carries
    // the parsed `Opinion[]`, and those have no business in an HTTP response.
    zapAudit: toAudit(signals),
    discussion,
    degraded: signals.degraded,
    elapsedMs: signals.elapsedMs,
    relays: signals.relays,
    relaysAnswered: signals.relaysAnswered,
    now: Math.floor(Date.now() / 1000),
    recentNoteLimit: config.recentNoteLimit,
  });
}

/**
 * Project the service config onto the discussion read's options.
 *
 * Kept here rather than inside `discussion.ts` so that module stays independent
 * of how this service happens to configure itself, and so the cap that bounds
 * the work (`discussionPostLimit`) is visible next to the call that spends it.
 */
export function toDiscussionOptions(config: ServiceConfig): DiscussionOptions {
  return {
    relays: config.relays,
    postLimit: config.discussionPostLimit,
    budgetMs: config.discussionBudgetMs,
    ttlMs: config.discussionTtlMs,
    zapTrust: config.zapTrust,
    lnurlTimeoutMs: config.lnurlTimeoutMs,
  };
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
