/**
 * One analysis run for a BIP: classified notes + summary + vote tally, mapped
 * into the frontend's `SentimentData`.
 *
 * Why this re-composes the pipeline instead of calling `analyzeBip()`:
 * `analyzeBip` returns only the aggregated `SentimentSummary`, which drops the
 * individual `ClassifiedNote[]` — and those notes are exactly what the
 * frontend's `recentNotes` is made of. Calling `analyzeBip` and then
 * classifying again would double the LLM spend for the same BIP, so we drive
 * the same three exported steps (`fetchBipNotes` -> `classifyNotes` ->
 * `summarizeSentiment`) ourselves and keep both halves of the result. If
 * `analyzeBip` ever returns its notes, collapse this back onto it.
 *
 * THIS IS NO LONGER THE DEFAULT PATH. `GET /sentiment/:bip` serves the
 * zaps-and-votes tally (`zaps.ts`) unless asked for `?mode=llm`. Everything
 * here still works and is still exercised; it is opt-in because it costs one
 * model call per note and answers in tens of seconds, which a two-minute demo
 * slot cannot spend. Nothing in here falls back to the fast path: if this
 * fails, the caller gets a 502 that names this path.
 */
import {
  classifyNotes,
  fetchBipNotes,
  makeClassifier,
  summarizeSentiment,
} from "@soft-fork-wiki/sentiment";
import type {
  ClassifiedNote,
  OpinionTally,
  SentimentSummary,
} from "@soft-fork-wiki/shared";
import { toSentimentData, type SentimentData } from "./adapter.js";
import { fetchOpinionTally } from "./opinions.js";
import type { ServiceConfig } from "./config.js";

export interface BipAnalysis {
  summary: SentimentSummary;
  notes: ClassifiedNote[];
  tally: OpinionTally;
}

/** Fetch, classify, summarize, and tally one BIP. Slow and LLM-billed. */
export async function analyzeBipDetailed(
  bipNumber: number,
  config: ServiceConfig,
): Promise<BipAnalysis> {
  const classifier = makeClassifier(config.provider);
  const computedAt = Math.floor(Date.now() / 1000);

  // The tally is a cheap relay read with no LLM cost, so it runs alongside the
  // classification pass rather than after it.
  const [analysis, tally] = await Promise.all([
    (async () => {
      const events = await fetchBipNotes(bipNumber, {
        relays: config.relays,
        limit: config.noteLimit,
      });
      const notes = await classifyNotes(classifier, bipNumber, events);
      const summary = await summarizeSentiment(classifier, bipNumber, notes, {
        computedAt,
      });
      return { summary, notes };
    })(),
    fetchOpinionTally(bipNumber, {
      relays: config.relays,
      limit: config.voteLimit,
      zapTrust: config.zapTrust,
      lnurlTimeoutMs: config.lnurlTimeoutMs,
      // The classification pass takes tens of seconds, so the tally is not on
      // the critical path here; give it a roomier budget than the zap route's
      // so a slow relay costs completeness there and nothing at all here.
      budgetMs: Math.max(config.zapBudgetMs, 8_000),
    }),
  ]);

  return { summary: analysis.summary, notes: analysis.notes, tally };
}

/**
 * Captured real readings, classified earlier from live Nostr. Served only when
 * a live run comes back empty — which today means the LLM key hit its spending
 * cap, not that the BIP has no discussion. Better to show the reading we
 * genuinely measured than a needle stuck at zero. `snapshot` marks it so the
 * caller can label it "as of" rather than "live".
 */
import SNAPSHOT from "./snapshot.json" with { type: "json" };

/** Timestamp of the captured readings committed in snapshot.json. */
const SNAPSHOT_COMPUTED_AT = 1_784_903_583;

type SnapshotEntry = {
  bipNumber: number; score: number; sampleSize: number;
  counts: { favour: number; against: number; neutral: number };
  satsFor: number; satsAgainst: number; totalSats: number;
  narrative?: string; recentNotes?: ClassifiedNote[];
};

/**
 * Rebuild a real `SentimentSummary` from the captured counts and run it back
 * through the same adapter a live run uses, so every derived field is correct
 * and consistent — we only substitute the source of the counts, not the maths.
 */
function fromSnapshot(bipNumber: number): SentimentData | null {
  const e = (SNAPSHOT as Record<string, SnapshotEntry>)[String(bipNumber)];
  if (!e) return null;
  const summary: SentimentSummary = {
    bipNumber,
    sampleSize: e.sampleSize,
    favour: e.counts.favour,
    against: e.counts.against,
    neutral: e.counts.neutral,
    netScore: e.score / 100,
    narrative: e.narrative ?? "",
    computedAt: SNAPSHOT_COMPUTED_AT,
  };
  return {
    ...toSentimentData({
      summary,
      notes: e.recentNotes ?? [],
      tally: {
        bipNumber, favour: 0, against: 0, neutral: 0, uniqueVoters: 0,
        zappedSatsFavour: 0, zappedSatsAgainst: 0,
      },
      now: Math.floor(Date.now() / 1000),
      recentNoteLimit: 8,
    }),
    snapshot: true,
  };
}

/** Analyze a BIP and return the exact payload the frontend consumes. */
export async function loadSentimentData(
  bipNumber: number,
  config: ServiceConfig,
): Promise<SentimentData> {
  // Snapshot-first for BIPs we have already measured. A cold live run classifies
  // 130-200 posts one model call at a time — tens of seconds, and a single
  // dropped connection surfaces as an error in the UI. For a proposal whose
  // reading we captured earlier the same day, serving it instantly is both
  // faster and more reliable, and the numbers are real. `?refresh=1` still
  // forces a live re-run, and BIPs with no snapshot always go live.
  if (config.snapshotFirst) {
    const snap = fromSnapshot(bipNumber);
    if (snap) return snap;
  }

  const { summary, notes, tally } = await analyzeBipDetailed(bipNumber, config);
  // Every note failed to classify (spend cap / provider outage). Fall back to
  // the captured reading rather than returning an all-zero gauge.
  if (summary.sampleSize === 0) {
    const snap = fromSnapshot(bipNumber);
    if (snap) return snap;
  }
  return toSentimentData({
    summary,
    notes,
    tally,
    now: Math.floor(Date.now() / 1000),
    recentNoteLimit: config.recentNoteLimit,
  });
}
