/**
 * Smoke test for the opinion + tally flow. No network required.
 *   pnpm --filter @soft-fork-wiki/voting dev
 */
import { generateSecretKey } from "nostr-tools";
import { buildOpinionEvent, signOpinion, parseOpinion } from "./opinion.js";
import { tallyOpinions } from "./tally.js";
import type { Opinion } from "@soft-fork-wiki/shared";

// created_at is fixed so the demo is deterministic.
const now = 1_753_000_000;

const sk = generateSecretKey();
const template = buildOpinionEvent({
  bipNumber: 110,
  stance: "favour",
  comment: "Makes light clients cheaper — I'm for it.",
  createdAt: now,
});
const event = signOpinion(template, sk);
const opinion = parseOpinion(event);

console.log("Signed opinion event:", event.id);
console.log("Parsed back:", opinion);

const sample: Opinion[] = [
  opinion!,
  { bipNumber: 110, pubkey: "a".repeat(64), stance: "against", source: "poll", createdAt: now },
  { bipNumber: 110, pubkey: "b".repeat(64), stance: "favour", source: "zap", amountMsat: 21_000, createdAt: now },
];

console.log("Tally for BIP 110:", tallyOpinions(110, sample));
