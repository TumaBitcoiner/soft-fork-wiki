/**
 * NIP-88 polls — the free, two-sided vote.
 *
 * A poll is a kind:1068 event whose options are For / Against / Neutral. Each
 * vote is a kind:1018 response referencing the poll (`e` tag) and naming the
 * chosen option (`response` tag). Counting is one-vote-per-pubkey: for each
 * pubkey, the most recent response wins.
 *
 * We use the Stance values ("favour" / "against" / "neutral") directly as the
 * NIP-88 option ids, so a response maps straight onto a stance.
 */
import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools";
import {
  APP_TAG,
  NOSTR_KINDS,
  bipHashtag,
  type Stance,
} from "@soft-fork-wiki/shared";

/** Poll options, in display order. Option id === Stance. */
export const POLL_OPTIONS: { id: Stance; label: string }[] = [
  { id: "favour", label: "In favour" },
  { id: "against", label: "Against" },
  { id: "neutral", label: "Neutral / undecided" },
];

export interface BuildPollInput {
  bipNumber: number;
  /** Optional BIP title, woven into the question. */
  bipTitle?: string;
  /** Relays the poll should collect responses from (NIP-88 "relay" tags). */
  relays?: string[];
  createdAt: number;
  /** Optional close time (unix seconds) -> NIP-88 "endsAt" tag. */
  endsAt?: number;
}

/** Build an unsigned NIP-88 poll (kind:1068) for a BIP. */
export function buildBipPoll(input: BuildPollInput): EventTemplate {
  const title = input.bipTitle ? ` — ${input.bipTitle}` : "";
  const tags: string[][] = [
    ...POLL_OPTIONS.map((o) => ["option", o.id, o.label]),
    ["polltype", "singlechoice"],
    ["t", bipHashtag(input.bipNumber)],
    ["t", APP_TAG],
  ];
  for (const r of input.relays ?? []) tags.push(["relay", r]);
  if (input.endsAt) tags.push(["endsAt", String(input.endsAt)]);

  return {
    kind: NOSTR_KINDS.POLL,
    created_at: input.createdAt,
    content: `Are you in favour of BIP ${input.bipNumber}${title}?`,
    tags,
  };
}

/** Build an unsigned NIP-88 response (kind:1018) casting a stance on a poll. */
export function buildPollResponse(input: {
  pollId: string;
  stance: Stance;
  createdAt: number;
}): EventTemplate {
  return {
    kind: NOSTR_KINDS.POLL_RESPONSE,
    created_at: input.createdAt,
    content: "",
    tags: [
      ["e", input.pollId],
      ["response", input.stance],
    ],
  };
}

export function signEvent(
  template: EventTemplate,
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(template, secretKey);
}

export interface ParsedPollResponse {
  pollId: string;
  pubkey: string;
  stance: Stance;
  eventId: string;
  createdAt: number;
}

/** Parse a kind:1018 response, or null if it isn't a well-formed poll vote. */
export function parsePollResponse(event: Event): ParsedPollResponse | null {
  if (event.kind !== NOSTR_KINDS.POLL_RESPONSE) return null;

  const pollId = event.tags.find((t) => t[0] === "e")?.[1];
  const optionId = event.tags.find((t) => t[0] === "response")?.[1];
  if (!pollId || !optionId) return null;
  if (!POLL_OPTIONS.some((o) => o.id === optionId)) return null;

  return {
    pollId,
    pubkey: event.pubkey,
    stance: optionId as Stance,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

export interface PollTally {
  pollId: string;
  favour: number;
  against: number;
  neutral: number;
  /** Distinct pubkeys counted (one vote each). */
  uniqueVoters: number;
}

/**
 * Tally responses for one poll with NIP-88 semantics: one vote per pubkey,
 * latest response wins.
 */
export function tallyPollResponses(
  pollId: string,
  responses: Event[],
): PollTally {
  const latestByPubkey = new Map<string, ParsedPollResponse>();

  for (const ev of responses) {
    const parsed = parsePollResponse(ev);
    if (!parsed || parsed.pollId !== pollId) continue;
    const prev = latestByPubkey.get(parsed.pubkey);
    if (!prev || parsed.createdAt > prev.createdAt) {
      latestByPubkey.set(parsed.pubkey, parsed);
    }
  }

  let favour = 0;
  let against = 0;
  let neutral = 0;
  for (const v of latestByPubkey.values()) {
    if (v.stance === "favour") favour++;
    else if (v.stance === "against") against++;
    else neutral++;
  }

  return {
    pollId,
    favour,
    against,
    neutral,
    uniqueVoters: latestByPubkey.size,
  };
}
