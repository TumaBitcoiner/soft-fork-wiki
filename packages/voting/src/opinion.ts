/**
 * Build, publish, and parse opinion events.
 *
 * We model an opinion as a NIP-01 text note tagged so it is discoverable both
 * as general BIP discussion and as a soft-fork-wiki opinion:
 *   - ["t", "bip110"]        -> the BIP hashtag
 *   - ["t", "softforkwiki"]  -> our app tag
 *   - ["L", "stance"] + ["l", "favour", "stance"]  -> NIP-32 labeled stance
 *
 * Using a plain kind:1 note (rather than a bespoke kind) means the opinion also
 * shows up in normal Nostr clients as part of the conversation.
 */
import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools";
import {
  APP_TAG,
  NOSTR_KINDS,
  bipHashtag,
  type Opinion,
  type Stance,
} from "@soft-fork-wiki/shared";

const STANCE_NAMESPACE = "stance";

export interface BuildOpinionInput {
  bipNumber: number;
  stance: Stance;
  /** Optional free-text comment shown in the note body. */
  comment?: string;
  /** Unix seconds; caller supplies to keep this pure/testable. */
  createdAt: number;
}

/** Build an unsigned opinion event template. */
export function buildOpinionEvent(input: BuildOpinionInput): EventTemplate {
  const { bipNumber, stance, comment, createdAt } = input;
  const body =
    comment?.trim() ||
    `I am ${stance} BIP ${bipNumber}. (via soft-fork-wiki)`;

  return {
    kind: NOSTR_KINDS.TEXT_NOTE,
    created_at: createdAt,
    content: body,
    tags: [
      ["t", bipHashtag(bipNumber)],
      ["t", APP_TAG],
      ["L", STANCE_NAMESPACE],
      ["l", stance, STANCE_NAMESPACE],
    ],
  };
}

/** Sign an opinion event with a secret key (Uint8Array, per nostr-tools v2). */
export function signOpinion(
  template: EventTemplate,
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(template, secretKey);
}

/** Parse a Nostr event back into an Opinion, or null if it isn't one of ours. */
export function parseOpinion(event: Event): Opinion | null {
  const tags = event.tags;
  const hasAppTag = tags.some((t) => t[0] === "t" && t[1] === APP_TAG);
  if (!hasAppTag) return null;

  const bipTag = tags.find(
    (t) => t[0] === "t" && /^bip\d+$/.test(t[1] ?? ""),
  );
  if (!bipTag) return null;
  const bipNumber = Number(bipTag[1].slice(3));

  const stanceTag = tags.find(
    (t) => t[0] === "l" && t[2] === STANCE_NAMESPACE,
  );
  const stance = (stanceTag?.[1] as Stance) ?? "neutral";

  return {
    bipNumber,
    pubkey: event.pubkey,
    stance,
    source: "poll",
    eventId: event.id,
    createdAt: event.created_at,
  };
}
