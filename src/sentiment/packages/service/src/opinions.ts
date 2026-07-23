/**
 * Read the *vote* side of a BIP off Nostr and fold it into an `OpinionTally`.
 *
 * The sentiment package only reads discussion, and a `SentimentSummary` has no
 * notion of votes or sats. All three vote mechanisms live on separate events —
 * NIP-88 poll responses, app-tagged opinion notes, and NIP-57 zap receipts — so
 * we fetch each here through the voting package and let `tallyOpinions` do the
 * arithmetic, keeping the counting rules in one place.
 *
 * This feeds the response's `totalVotes` (via `uniqueVoters`), so under-reading
 * any one mechanism understates the headline number on screen.
 *
 * No LLM involvement, so this is cheap; it is still network-bound, which is why
 * the caller runs it alongside the (much slower) classification pass.
 */
import {
  APP_TAG,
  NOSTR_KINDS,
  bipHashtag,
  type Opinion,
  type OpinionTally,
} from "@soft-fork-wiki/shared";
import {
  NostrClient,
  parseOpinion,
  parsePollResponse,
  parseZapReceipt,
  tallyOpinions,
} from "@soft-fork-wiki/voting";

export interface FetchTallyOptions {
  relays?: string[];
  /** Max events to pull per kind. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;

/** How many poll events we will consider for one BIP. There should be one. */
const MAX_POLLS = 20;

/** An all-zero tally, built through `tallyOpinions` so the shape can't drift. */
export function emptyTally(bipNumber: number): OpinionTally {
  return tallyOpinions(bipNumber, []);
}

/**
 * Read NIP-88 poll votes for a BIP as `Opinion`s.
 *
 * Two hops, because a kind:1018 response points at a poll by event id and we
 * only know the BIP: find our kind:1068 poll(s) for the BIP, then fetch the
 * responses that reference them.
 *
 * We apply NIP-88's "one vote per pubkey, latest wins" rule here rather than
 * calling `tallyPollResponses`, because that returns counts and we need the
 * pubkeys — `uniqueVoters` has to deduplicate someone who both voted in the
 * poll and zapped, and it can only do that if every mechanism contributes
 * `Opinion`s to a single tally.
 */
async function fetchPollOpinions(
  client: NostrClient,
  bipNumber: number,
  limit: number,
): Promise<Opinion[]> {
  const polls = await client.query({
    kinds: [NOSTR_KINDS.POLL],
    "#t": [bipHashtag(bipNumber)],
    limit: MAX_POLLS,
  });

  // A relay's `#t` filter matches ANY listed value, so asking for both tags at
  // once would not narrow this to our polls. Confirm the app tag locally.
  const ours = polls.filter((poll) =>
    poll.tags.some((t) => t[0] === "t" && t[1] === APP_TAG),
  );
  if (ours.length === 0) return [];

  const pollIds = new Set(ours.map((poll) => poll.id));
  const responses = await client.query({
    kinds: [NOSTR_KINDS.POLL_RESPONSE],
    "#e": [...pollIds],
    limit,
  });

  const latestByPubkey = new Map<string, Opinion>();
  for (const event of responses) {
    const parsed = parsePollResponse(event);
    // Re-check the poll id: `#e` also matches responses that merely reply to
    // the poll thread.
    if (!parsed || !pollIds.has(parsed.pollId)) continue;

    const previous = latestByPubkey.get(parsed.pubkey);
    if (previous && previous.createdAt >= parsed.createdAt) continue;
    latestByPubkey.set(parsed.pubkey, {
      bipNumber,
      pubkey: parsed.pubkey,
      stance: parsed.stance,
      source: "poll",
      eventId: parsed.eventId,
      createdAt: parsed.createdAt,
    });
  }

  return [...latestByPubkey.values()];
}

/**
 * Fetch poll responses, opinion notes, and zap receipts for a BIP, and tally
 * them into one `OpinionTally`.
 *
 * A person who votes in the poll *and* zaps contributes two `Opinion`s, so the
 * stance counts weight them twice — but `uniqueVoters`, which is what we
 * surface as `totalVotes`, deduplicates by pubkey and counts them once.
 *
 * Never throws: sentiment is the primary payload, and a relay refusing a
 * subscription should degrade the vote/sats counters to zero rather than fail
 * the whole request with a 502.
 */
export async function fetchOpinionTally(
  bipNumber: number,
  opts: FetchTallyOptions = {},
): Promise<OpinionTally> {
  const client = new NostrClient({ relays: opts.relays });
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const hashtag = bipHashtag(bipNumber);

  try {
    // Separate queries rather than one `kinds: [1, 1018, 9735]` filter: each
    // kind has its own parser, and a shared filter would make the per-kind
    // limits fight each other.
    const [notes, receipts, pollOpinions] = await Promise.all([
      client.query({
        kinds: [NOSTR_KINDS.TEXT_NOTE],
        "#t": [hashtag],
        limit,
      }),
      client.query({
        kinds: [NOSTR_KINDS.ZAP_RECEIPT],
        "#t": [hashtag],
        limit,
      }),
      fetchPollOpinions(client, bipNumber, limit),
    ]);

    const opinions: Opinion[] = [...pollOpinions];
    // `parseOpinion` returns null for anything without our app tag, so organic
    // discussion is filtered out here — it belongs to the sentiment pass, not
    // the vote count.
    for (const event of notes) {
      const opinion = parseOpinion(event);
      if (opinion) opinions.push(opinion);
    }
    for (const receipt of receipts) {
      const opinion = parseZapReceipt(receipt);
      if (opinion) opinions.push(opinion);
    }

    return tallyOpinions(bipNumber, opinions);
  } catch (err) {
    console.warn(`opinion tally failed for BIP ${bipNumber}:`, err);
    return emptyTally(bipNumber);
  } finally {
    client.close();
  }
}
