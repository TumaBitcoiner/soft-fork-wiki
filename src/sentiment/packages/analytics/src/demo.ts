/**
 * Offline smoke test. No network, no keys, deterministic output.
 *   pnpm --filter @soft-fork-wiki/analytics dev
 *
 * The sample below is illustrative, not a historical source: it mixes the
 * Python API's snake_case row shape with the frontend's camelCase `Bip` shape,
 * and deliberately includes broken rows, so running this exercises the
 * normaliser's skip accounting as well as the maths.
 */

import { computeBipAnalytics } from "./analyze.js";

// Frozen so the report is byte-identical on every run.
const GENERATED_AT = 1_753_000_000;

const records: unknown[] = [
  // --- Python API shape: snake_case, no activation date, authors as one string.
  {
    bip_number: 34,
    title: "Block v2, Height in Coinbase",
    status: "Deployed",
    layer: "Consensus (soft fork)",
    type: "Standards Track",
    authors: "Gavin Andresen <gavin@example.org>",
    created: "2012-07-06",
  },
  {
    bip_number: 66,
    title: "Strict DER signatures",
    status: "Deployed",
    layer: "Consensus (soft fork)",
    type: "Standards Track",
    authors: "Pieter Wuille",
    created: "2015-01-10",
  },
  {
    bip_number: 119,
    title: "CHECKTEMPLATEVERIFY",
    status: "Draft",
    layer: "Consensus (soft fork)",
    type: "Standards Track",
    authors: "Jeremy Rubin",
    created: "2020-01-06",
  },
  {
    bip_number: 118,
    title: "SIGHASH_ANYPREVOUT",
    status: "Draft",
    layer: "Consensus (soft fork)",
    type: "Standards Track",
    created: "2019-02-28",
  },

  // --- Frontend `Bip` shape: camelCase, explicit era/topic and an activation date.
  {
    number: 141,
    title: "Segregated Witness",
    status: "Deployed",
    layer: "Consensus",
    topic: "Scaling",
    era: "2015–2017",
    authors: ["Eric Lombrozo", "Johnson Lau", "Pieter Wuille"],
    created: "2015-12-21",
    activated: "2017-08-24",
  },
  {
    number: 341,
    title: "Taproot: SegWit version 1 spending rules",
    status: "Deployed",
    layer: "Consensus",
    topic: "Script",
    era: "2018–2021",
    authors: ["Pieter Wuille", "Jonas Nick", "Anthony Towns"],
    created: "2020-01-19",
    activated: "2021-11-14",
  },
  {
    number: 340,
    title: "Schnorr Signatures for secp256k1",
    status: "Complete",
    layer: "Cryptography",
    topic: "Signatures",
    era: "2018–2021",
    created: "2020-01-19",
  },
  {
    number: 62,
    title: "Dealing with malleability",
    status: "Withdrawn",
    layer: "Consensus",
    topic: "Malleability",
    created: "2014-03-12",
  },

  // --- Rows that must not crash anything.
  null,
  "not a record",
  { title: "no number at all", status: "Draft" },
  { number: 34, title: "duplicate of BIP 34", status: "Draft" },
  { number: 999, title: "unreadable created date", status: "Draft", created: "sometime in 2019" },
  { number: 1000, title: "unknown status", status: "Bikeshedding", created: "2018-04-01" },
];

/**
 * Activation dates the API does not carry.
 *
 * This is the hook a real consumer would back with its own history table; here
 * it is a two-entry map so the time-to-activation section has something to chew
 * on beyond the two records that ship their own dates.
 */
const KNOWN_ACTIVATIONS: Record<number, string> = {
  34: "2013-03-25",
  66: "2015-07-04",
};

const analytics = computeBipAnalytics(records, {
  generatedAt: GENERATED_AT,
  activationDateFor: (bip) => KNOWN_ACTIVATIONS[bip.number],
  // Tiny sample: drop the threshold so the flag means something in the output.
  minGroupSize: 3,
});

console.log("Input quality:", analytics.input);
console.log("\nOverall:", analytics.overall);
console.log("\nStatus mix:", analytics.statusMix);
console.log("\nBy layer:", analytics.byLayer);
console.log("\nBy era:", analytics.byEra);
console.log("\nTime to activation (days):", analytics.timeToActivation.days);
console.log("Histogram:", analytics.timeToActivation.histogram);
console.log("Fastest:", analytics.timeToActivation.fastest);
console.log("Slowest:", analytics.timeToActivation.slowest);
console.log(
  "\nTrend:",
  analytics.trend.map((point) => ({
    year: point.year,
    created: point.created,
    activated: point.activated,
    approvalRate: point.approvalRate,
  })),
);
