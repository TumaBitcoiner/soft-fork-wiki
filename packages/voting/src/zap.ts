/**
 * Zap-to-vote (NIP-57).
 *
 * Flow:
 *  1. Build a kind:9734 zap request tagged with the BIP AND the stance the zap
 *     expresses (favour / against).
 *  2. Hand it to the recipient's LNURL-pay callback (`?nostr=<event>&amount=`),
 *     get a bolt11 invoice, and have the user pay it (WebLN / wallet).
 *  3. The LN server publishes a kind:9735 zap receipt. We read those receipts
 *     back and count each as a weighted vote for that stance.
 *
 * Zaps are two-sided: each BIP has two zap targets (a FOR anchor and an AGAINST
 * anchor — two notes or two Lightning addresses). Which target you zap is the
 * stance; the amount in sats is the weight. We also stamp the stance on the zap
 * request itself so the receipt is self-describing without needing the
 * target->stance mapping. See docs/architecture.md.
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

export interface BuildZapRequestInput {
  bipNumber: number;
  /** Stance this zap expresses. Zaps are for "favour" or "against". */
  stance: Extract<Stance, "favour" | "against">;
  /** Recipient pubkey (hex) — the BIP's FOR or AGAINST vote account. */
  recipientPubkey: string;
  /** Amount to zap, in millisats. */
  amountMsat: number;
  /** Relays the zap receipt should be published to. */
  relays: string[];
  /** The stance anchor note being zapped (adds an "e" tag). */
  zappedEventId?: string;
  createdAt: number;
  /** Optional message shown with the zap. */
  comment?: string;
}

/** Build an unsigned NIP-57 zap request template. */
export function buildZapRequest(input: BuildZapRequestInput): EventTemplate {
  const tags: string[][] = [
    ["p", input.recipientPubkey],
    ["amount", String(input.amountMsat)],
    ["relays", ...input.relays],
    ["t", bipHashtag(input.bipNumber)],
    ["t", APP_TAG],
    ["L", STANCE_NAMESPACE],
    ["l", input.stance, STANCE_NAMESPACE],
  ];
  if (input.zappedEventId) tags.push(["e", input.zappedEventId]);

  return {
    kind: NOSTR_KINDS.ZAP_REQUEST,
    created_at: input.createdAt,
    content: input.comment ?? "",
    tags,
  };
}

export function signZapRequest(
  template: EventTemplate,
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(template, secretKey);
}

/**
 * Interpret a kind:9735 zap receipt as an Opinion.
 *
 * The receipt embeds the original zap request JSON in its "description" tag;
 * we read the BIP tag and amount from there. Returns null if it isn't a
 * soft-fork-wiki BIP zap.
 */
export function parseZapReceipt(receipt: Event): Opinion | null {
  if (receipt.kind !== NOSTR_KINDS.ZAP_RECEIPT) return null;

  const description = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (!description) return null;

  let zapRequest: Event;
  try {
    zapRequest = JSON.parse(description) as Event;
  } catch {
    return null;
  }

  const reqTags = zapRequest.tags ?? [];
  const isOurs = reqTags.some((t) => t[0] === "t" && t[1] === APP_TAG);
  if (!isOurs) return null;

  const bipTag = reqTags.find(
    (t) => t[0] === "t" && /^bip\d+$/.test(t[1] ?? ""),
  );
  if (!bipTag) return null;

  const amountMsat = Number(
    reqTags.find((t) => t[0] === "amount")?.[1] ?? 0,
  );

  // Stance is stamped on the zap request; default to "favour" for legacy
  // single-target zaps that predate two-sided voting.
  const stanceTag = reqTags.find(
    (t) => t[0] === "l" && t[2] === STANCE_NAMESPACE,
  );
  const stance = (stanceTag?.[1] as Stance) ?? "favour";

  return {
    bipNumber: Number(bipTag[1].slice(3)),
    // The zapping user is the author of the zap request, not the receipt.
    pubkey: zapRequest.pubkey,
    stance,
    source: "zap",
    amountMsat: Number.isFinite(amountMsat) ? amountMsat : undefined,
    eventId: receipt.id,
    createdAt: receipt.created_at,
  };
}
