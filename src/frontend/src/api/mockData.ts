import type { Bip, SentimentData, TimelineItem } from './types';

const source = (bip: number, section: string, excerpt: string) => ({
  id: `${bip}-${section.toLowerCase().replaceAll(' ', '-')}`,
  label: `BIP ${bip} source`, section,
  url: `https://github.com/bitcoin/bips/blob/master/bip-${String(bip).padStart(4, '0')}.mediawiki`,
  excerpt,
});

interface BipSeed {
  title: string;
  topic: string;
  layer: string;
  status: Bip['status'];
  difficulty: Bip['difficulty'];
  era: string;
  plainSummary: string;
  summary: string;
  inPlainTerms: string;
  whatItChanges: string[];
  caseFor: string[];
  caseAgainst: string[];
  stillUnclear: string[];
}

const details: Record<number, BipSeed> = {
  34: {
    title: 'Block v2, Height in Coinbase',
    topic: 'Validation', layer: 'Consensus', status: 'Deployed', difficulty: 'Beginner', era: '2012–2013',
    plainSummary: 'Makes every mined block include its own height number, so blocks can’t be confused with each other.',
    summary: 'Commits the block height in the coinbase transaction to make each coinbase unique.',
    inPlainTerms: 'Before this change, two different blocks could accidentally end up with an identical coinbase transaction, which caused headaches for wallets and light clients trying to tell blocks apart. BIP34 just asks every miner to write the block’s height into the coinbase, like a page number in a book.',
    whatItChanges: [
      'Miners must include the block height inside the coinbase transaction.',
      'Nodes reject new blocks that omit the height field.',
      'Old-style blocks without a height become invalid going forward.',
    ],
    caseFor: [
      'Removes a source of duplicate transaction IDs that confused early wallets.',
      'A small, narrowly scoped change with a long, uneventful track record.',
      'Made later validation upgrades (like BIP66) easier to sequence.',
    ],
    caseAgainst: [
      'Any consensus rule change carries some upgrade risk, however small.',
      'Miners running very old software needed to update to stay compatible.',
    ],
    stillUnclear: [
      'Nothing meaningful — this change has been active and uncontroversial for over a decade.',
    ],
  },
  65: {
    title: 'OP_CHECKLOCKTIMEVERIFY',
    topic: 'Script', layer: 'Consensus', status: 'Deployed', difficulty: 'Beginner', era: '2014–2015',
    plainSummary: 'Lets a transaction say "don’t spend this until a certain date or block height."',
    summary: 'Adds an absolute timelock condition that scripts can enforce before coins are spent.',
    inPlainTerms: 'CLTV is like writing "do not cash before this date" on a check. It gives Bitcoin scripts a way to lock funds until a specific future block height or timestamp, which is the building block behind things like escrow and simple savings contracts.',
    whatItChanges: [
      'Adds a new script opcode, OP_CHECKLOCKTIMEVERIFY.',
      'A transaction using it becomes invalid until the specified time or height is reached.',
      'Enables absolute time-locked spending conditions in standard script.',
    ],
    caseFor: [
      'Useful, minimal primitive for time-based contracts and savings vaults.',
      'Backward compatible — it repurposed a previously unused opcode.',
      'Broadly adopted by wallets without controversy.',
    ],
    caseAgainst: [
      'Adds another opcode for implementers to correctly support.',
      'Absolute timelocks can be less flexible than relative ones for some contracts.',
    ],
    stillUnclear: [
      'Little remains unclear — this proposal is long deployed and well understood.',
    ],
  },
  66: {
    title: 'Strict DER Signatures',
    topic: 'Signatures', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2014–2015',
    plainSummary: 'Forces signatures to be encoded in exactly one valid way, closing a loophole that let transactions be subtly altered.',
    summary: 'Requires strict DER encoding for ECDSA signatures, removing transaction malleability ambiguity.',
    inPlainTerms: 'Signatures used to have some “wiggle room” in how they could be encoded, which meant someone could take a valid transaction and re-encode it slightly differently, changing its ID without changing what it did. BIP66 says there’s only one correct way to encode a signature from now on.',
    whatItChanges: [
      'Requires all ECDSA signatures to follow the strict DER format.',
      'Blocks containing non-strict signatures become invalid.',
      'Removes one specific class of transaction malleability.',
    ],
    caseFor: [
      'Closes a well-understood malleability vector with a narrow, surgical fix.',
      'A necessary stepping stone toward later fixes and better tooling.',
    ],
    caseAgainst: [
      'Only addressed one of several malleability sources at the time.',
      'Required coordinated miner upgrades to enforce as a soft fork.',
    ],
    stillUnclear: [
      'Nothing significant remains open; this is long-settled, foundational infrastructure.',
    ],
  },
  68: {
    title: 'Relative Lock-time Using Sequence Numbers',
    topic: 'Timelocks', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2015–2016',
    plainSummary: 'Lets a transaction say "wait this many blocks after it was confirmed" instead of a fixed date.',
    summary: 'Repurposes sequence numbers to express relative lock-time constraints.',
    inPlainTerms: 'Instead of locking coins to a specific calendar date, BIP68 lets a transaction say “wait N blocks after this input was confirmed.” That relative countdown is exactly what payment channels like Lightning rely on to enforce fair settlement windows.',
    whatItChanges: [
      'Gives new meaning to the transaction sequence number field.',
      'Allows relative, rather than only absolute, time-based spending conditions.',
      'Lays groundwork for CSV (BIP112) and payment-channel constructions.',
    ],
    caseFor: [
      'Enabled practical payment channels and dispute windows.',
      'Reused an existing field rather than adding new transaction data.',
    ],
    caseAgainst: [
      'Added complexity to how sequence numbers are interpreted.',
      'Required careful coordination with BIP112 to be useful in practice.',
    ],
    stillUnclear: [
      'Little debate remains; it is a stable, widely relied-upon primitive.',
    ],
  },
  112: {
    title: 'OP_CHECKSEQUENCEVERIFY',
    topic: 'Script', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2015–2016',
    plainSummary: 'Lets a script enforce the "wait N blocks" rule from BIP68 directly at spend time.',
    summary: 'Lets scripts enforce relative timelocks defined by transaction sequence numbers.',
    inPlainTerms: 'CSV is the script-level partner to BIP68. It lets a transaction script check "has enough time passed since this output was confirmed?" before allowing a spend — a key ingredient for Lightning-style channels and time-delayed refund paths.',
    whatItChanges: [
      'Adds the OP_CHECKSEQUENCEVERIFY opcode.',
      'Lets scripts enforce relative lock-times introduced by BIP68.',
      'Underpins payment-channel refund and dispute logic.',
    ],
    caseFor: [
      'Directly enabled practical, widely used Lightning Network constructions.',
      'Deployed smoothly alongside CLTV with strong ecosystem support.',
    ],
    caseAgainst: [
      'Adds more branching logic for script implementers to test correctly.',
    ],
    stillUnclear: [
      'Nothing significant remains open for this deployed, foundational opcode.',
    ],
  },
  113: {
    title: 'Median Time-Past for Lock-time',
    topic: 'Timelocks', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2015–2016',
    plainSummary: 'Changes how "current time" is measured on-chain, using a median of recent blocks instead of a single, easily-fudged timestamp.',
    summary: 'Uses median past block time when evaluating transaction lock-times.',
    inPlainTerms: 'Miners have some wiggle room to fudge a block’s timestamp. BIP113 says that when checking a timelock, nodes should use the median of the last 11 blocks’ timestamps instead of trusting a single, more easily manipulated value.',
    whatItChanges: [
      'Switches the reference clock for lock-time checks to median-time-past.',
      'Makes timestamp manipulation less useful for gaming timelocks.',
      'Applies to CLTV-based spending conditions.',
    ],
    caseFor: [
      'Meaningfully reduces a subtle timestamp-manipulation attack surface.',
      'Small, targeted fix with broad ecosystem agreement.',
    ],
    caseAgainst: [
      'Slightly changes timing assumptions that some existing contracts relied on.',
    ],
    stillUnclear: [
      'Nothing significant remains open; this has been stable in production for years.',
    ],
  },
  119: {
    title: 'CHECKTEMPLATEVERIFY',
    topic: 'Covenants', layer: 'Consensus', status: 'Draft', difficulty: 'Advanced', era: 'Active research',
    plainSummary: 'A proposal that would let someone lock coins so they can only later be spent in one exact, pre-agreed way.',
    summary: 'Proposes a template hash commitment for constrained transaction spending paths.',
    inPlainTerms: 'Imagine writing a rule that says "this money can only ever be spent by paying these exact people, this exact amount, later." CTV lets a transaction commit to a template of what a future spend must look like, which opens the door to things like congestion-control batching, vaults, and non-custodial pre-signed payment trees.',
    whatItChanges: [
      'Adds a new opcode, OP_CHECKTEMPLATEVERIFY.',
      'Lets an output commit to a hash of a future transaction’s structure.',
      'Restricts how a coin can be spent to a pre-committed template.',
    ],
    caseFor: [
      'Enables safer self-custody vaults with pre-committed recovery paths.',
      'Supports congestion-control batching that could reduce fee pressure at peak times.',
      'Narrow in scope compared to more general covenant proposals.',
    ],
    caseAgainst: [
      'Any covenant-style opcode raises long-term questions about how spending restrictions could be composed or misused.',
      'Some argue it should be bundled with, or sequenced after, other covenant proposals for a more complete design.',
      'Real-world usage patterns and tooling are still maturing.',
    ],
    stillUnclear: [
      'Whether CTV should activate on its own or alongside related covenant opcodes.',
      'How much real demand exists from wallets and vault products today.',
      'Long-term implications for fee markets and UTXO set growth.',
    ],
  },
  141: {
    title: 'Segregated Witness (Consensus layer)',
    topic: 'Scaling', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2015–2017',
    plainSummary: 'Moves signature data outside the part of a transaction used to compute its ID, fixing a long-standing malleability problem.',
    summary: 'Separates witness data from the transaction identifier and introduces block weight.',
    inPlainTerms: 'Before SegWit, a transaction’s ID included its signatures, so someone could tweak a signature slightly and change the ID without changing what the transaction actually did. SegWit moves signatures into a separate “witness” area that isn’t counted toward the ID, and also gives blocks more effective room by discounting witness data.',
    whatItChanges: [
      'Splits transaction signature data into a separate witness structure.',
      'Transaction IDs no longer include witness data, fixing third-party malleability.',
      'Introduces block weight, discounting witness bytes versus the old 1MB size limit.',
    ],
    caseFor: [
      'Solved malleability issues that blocked reliable Lightning-style channels.',
      'Effectively increased block capacity without a hard fork.',
      'Enabled a path to further script upgrades like Taproot.',
    ],
    caseAgainst: [
      'The 2015–2017 rollout coincided with one of Bitcoin’s most contentious scaling debates.',
      'Some argued a straightforward block-size increase would have been simpler.',
      'Adoption by wallets and exchanges took years to become widespread.',
    ],
    stillUnclear: [
      'Historical debate about alternative scaling paths continues among some community members, though SegWit itself is settled, active consensus today.',
    ],
  },
  143: {
    title: 'Transaction Signature Verification for Version 0 Witness Program',
    topic: 'Signatures', layer: 'Consensus', status: 'Deployed', difficulty: 'Advanced', era: '2015–2017',
    plainSummary: 'Defines a faster, safer way to compute what a SegWit signature actually signs.',
    summary: 'Defines a more efficient signature digest algorithm for SegWit version 0.',
    inPlainTerms: 'This is the technical rulebook for exactly what bytes get hashed and signed in a SegWit transaction. It fixed some quadratic-hashing performance issues from legacy transactions and made signing amounts explicit, which closes another malleability angle.',
    whatItChanges: [
      'Defines a new signature hash algorithm for SegWit v0 outputs.',
      'Commits the exact spent amount into the signature, closing a fee-based attack.',
      'Avoids quadratic hashing costs present in legacy transaction signing.',
    ],
    caseFor: [
      'Fixes a real performance and security issue in the legacy signing algorithm.',
      'A necessary companion piece to BIP141 rather than an optional add-on.',
    ],
    caseAgainst: [
      'Highly technical — most users never interact with it directly, which makes independent review harder for non-specialists.',
    ],
    stillUnclear: [
      'Nothing significant remains open; this is stable, load-bearing infrastructure.',
    ],
  },
  147: {
    title: 'Dealing with Dummy Stack Element Malleability',
    topic: 'Malleability', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2015–2017',
    plainSummary: 'Closes one more small loophole that let multisig transactions be re-encoded without changing what they do.',
    summary: 'Requires the extra CHECKMULTISIG stack element to be empty.',
    inPlainTerms: 'Multisig scripts have long included a strange, unused placeholder value on the stack. Because that value wasn’t checked, someone could swap it for something else, changing the transaction ID without changing its effect. BIP147 just requires that placeholder to always be empty.',
    whatItChanges: [
      'Requires the CHECKMULTISIG dummy element to be exactly empty.',
      'Removes another minor, well-known malleability vector.',
      'Applies to standard multisig spending scripts.',
    ],
    caseFor: [
      'A small, low-risk cleanup that removed a long-known quirk.',
      'Bundled cleanly with the broader SegWit soft-fork activation.',
    ],
    caseAgainst: [
      'Extremely narrow in scope — mostly relevant to protocol implementers, not end users.',
    ],
    stillUnclear: [
      'Nothing meaningful remains unresolved.',
    ],
  },
  340: {
    title: 'Schnorr Signatures for secp256k1',
    topic: 'Signatures', layer: 'Cryptography', status: 'Final', difficulty: 'Advanced', era: '2018–2021',
    plainSummary: 'Introduces a newer, more flexible signature scheme that also makes multi-signature setups look like a single signature.',
    summary: 'Specifies 64-byte Schnorr signatures with deterministic verification behavior.',
    inPlainTerms: 'Schnorr signatures are smaller, easier to verify in batches, and — importantly — can be combined so that several signers look identical to a single signer on-chain. That combining trick is what makes many privacy and efficiency gains in Taproot possible.',
    whatItChanges: [
      'Defines a standard 64-byte Schnorr signature format for secp256k1.',
      'Enables signature aggregation across multiple signers.',
      'Provides deterministic, more easily provable verification behavior than ECDSA.',
    ],
    caseFor: [
      'Smaller signatures and cheaper batch verification.',
      'Enables key aggregation, improving privacy for multisig and channels.',
      'Well-studied cryptography with a long academic track record.',
    ],
    caseAgainst: [
      'Introducing a new cryptographic primitive always carries implementation risk.',
      'Required careful, conservative specification work to avoid subtle bugs.',
    ],
    stillUnclear: [
      'Little remains unclear — this is finalized, widely reviewed, and activated as part of Taproot.',
    ],
  },
  341: {
    title: 'Taproot: SegWit Version 1 Spending Rules',
    topic: 'Privacy', layer: 'Consensus', status: 'Deployed', difficulty: 'Intermediate', era: '2018–2021',
    plainSummary: 'Lets complex spending conditions look exactly like a simple single-signature payment when everyone cooperates.',
    summary: 'Combines key-path and script-path spending under a single compact output.',
    inPlainTerms: 'Taproot lets a Bitcoin output be spent either through a single aggregated key (the common, cooperative case) or by revealing just the one script branch that was actually used (the fallback case). To an outside observer, a Taproot multisig-with-conditions can look identical to an ordinary single-key spend.',
    whatItChanges: [
      'Introduces SegWit version 1 outputs using Taproot.',
      'Lets a single output support both key-path and script-path spending.',
      'Only the executed script branch is revealed on-chain — unused branches stay private.',
    ],
    caseFor: [
      'Meaningfully improves privacy by hiding unused spending conditions.',
      'Reduces on-chain data for complex scripts in the cooperative case.',
      'Broad, multi-year technical review and smooth activation process.',
    ],
    caseAgainst: [
      'Adds new script complexity that took time for wallets to properly support.',
      'Some argue improved script flexibility could complicate future policy debates (e.g. around covenants).',
    ],
    stillUnclear: [
      'Full ecosystem adoption of Taproot addresses and PSBT tooling is still ongoing.',
      'Long-term implications for how future opcodes build on Tapscript.',
    ],
  },
  342: {
    title: 'Validation of Taproot Scripts',
    topic: 'Script', layer: 'Consensus', status: 'Deployed', difficulty: 'Advanced', era: '2018–2021',
    plainSummary: 'The rulebook for how scripts inside a Taproot spend are checked, including new upgrade-friendly rules.',
    summary: 'Defines Tapscript, updating script validation rules for Taproot script paths.',
    inPlainTerms: 'Tapscript is the “script language” used inside Taproot’s script-path spends. It removes some legacy quirks, adds clearer rules around signature operation limits, and — notably — treats unrecognized public key types as automatically valid, which makes future upgrades smoother.',
    whatItChanges: [
      'Defines validation rules for Taproot script-path spending (Tapscript).',
      'Removes the legacy CHECKMULTISIG opcode in favor of CHECKSIGADD.',
      'Makes unknown public key versions valid by default, easing future upgrades.',
    ],
    caseFor: [
      'Cleaner, more consistent script rules than legacy Bitcoin Script.',
      'The "upgradable by default" design makes future soft forks easier to reason about.',
    ],
    caseAgainst: [
      'The upgradability design means future opcodes could change script behavior in ways that require ongoing vigilance from validators.',
      'More rule changes at once made the specification review process more demanding.',
    ],
    stillUnclear: [
      'How the upgrade-friendly design will be used for future opcode proposals like OP_CAT or CTV.',
    ],
  },
  347: {
    title: 'OP_CAT in Tapscript',
    topic: 'Covenants', layer: 'Consensus', status: 'Draft', difficulty: 'Advanced', era: 'Active research',
    plainSummary: 'A proposal to bring back a simple opcode that joins two pieces of data together, within safe size limits.',
    summary: 'Proposes restoring a bounded concatenation opcode for Tapscript.',
    inPlainTerms: 'OP_CAT was disabled in early Bitcoin over resource-exhaustion concerns. Reintroducing it, but bounded by Tapscript’s stack-size limits, would let scripts join two values together — a small building block that enables surprisingly powerful constructions like vaults and certain covenant designs, without needing an entirely new opcode.',
    whatItChanges: [
      'Re-enables OP_CAT, disabled since 2010, specifically within Tapscript.',
      'Concatenates the top two stack elements, bounded by the existing max element size.',
      'Combined with other opcodes, can express covenant-like spending restrictions.',
    ],
    caseFor: [
      'A minimal, general-purpose primitive rather than a single-purpose opcode.',
      'Reintroduces functionality removed for reasons that may no longer fully apply under Tapscript’s limits.',
      'Could enable a wide range of constructions without needing many separate new opcodes.',
    ],
    caseAgainst: [
      'General-purpose opcodes can be combined in ways that are harder to fully anticipate or review.',
      'Some worry about unintended covenant-like use cases emerging from a simple primitive.',
      'Historical caution remains from why it was disabled in the first place.',
    ],
    stillUnclear: [
      'What real-world use cases will actually emerge if it activates.',
      'Whether it should be evaluated together with other covenant proposals like CTV.',
      'Long-term script-analysis tooling implications for wallets and analysts.',
    ],
  },
  348: {
    title: 'OP_CHECKSIGFROMSTACK',
    topic: 'Signatures', layer: 'Consensus', status: 'Draft', difficulty: 'Advanced', era: 'Active research',
    plainSummary: 'A proposal to let a script check a signature against any message supplied on the stack, not just the transaction itself.',
    summary: 'Proposes signature verification over a message supplied directly by the stack.',
    inPlainTerms: 'Normally, Bitcoin scripts can only check a signature against the transaction that’s spending the coin. CSFS would let a script verify a signature over any message provided on the stack — opening the door to oracle-style constructions, vaults, and some interesting cross-chain and payment-pool designs.',
    whatItChanges: [
      'Adds OP_CHECKSIGFROMSTACK to Tapscript.',
      'Allows signature verification over an arbitrary stack-provided message.',
      'Enables oracle and delegation-style script constructions.',
    ],
    caseFor: [
      'A small, well-scoped primitive with clear, specific use cases.',
      'Often discussed as complementary to OP_CAT for enabling richer script logic.',
    ],
    caseAgainst: [
      'New signature-checking flexibility raises questions about novel attack surfaces.',
      'Like other covenant-adjacent proposals, real usage patterns are still theoretical.',
    ],
    stillUnclear: [
      'Whether it should activate alongside OP_CAT or independently.',
      'How much practical demand exists from real applications today.',
    ],
  },
};

export const bips: Bip[] = Object.entries(details).map(([key, value]) => {
  const number = Number(key);
  const created = number < 100 ? '2012-03-15' : number < 200 ? '2015-12-21' : number < 343 ? '2020-01-19' : '2024-04-23';
  return {
    number,
    title: value.title,
    status: value.status,
    layer: value.layer,
    topic: value.topic,
    era: value.era,
    difficulty: value.difficulty,
    plainSummary: value.plainSummary,
    summary: value.summary,
    inPlainTerms: value.inPlainTerms,
    whatItChanges: value.whatItChanges,
    caseFor: value.caseFor,
    caseAgainst: value.caseAgainst,
    stillUnclear: value.stillUnclear,
    whyItMatters: number === 141 ? 'SegWit fixed third-party transaction malleability for covered inputs and created a safer foundation for payment channels such as Lightning.' : number === 341 ? 'Taproot makes many complex spending policies look like ordinary single-signature spends when participants cooperate.' : number === 119 ? 'CTV explores a narrowly scoped covenant primitive for congestion control, vaults, and pre-committed transaction trees.' : `BIP ${number} is part of the documented evolution of Bitcoin’s consensus and validation behavior.`,
    whatChanged: number === 342 ? 'Tapscript removes the legacy CHECKMULTISIG behavior, introduces signature-op budgeting, and makes unknown public-key types upgradable.' : number === 347 ? 'The proposal would concatenate the top two stack elements, subject to Tapscript’s maximum stack-element size.' : value.summary,
    risks: value.status === 'Draft' ? 'This proposal is not active consensus. Review focuses on expressiveness, implementation complexity, and unintended interactions with existing script rules.' : 'Historical activation required careful deployment coordination and compatibility review. The exact guarantees depend on the specified consensus rules.',
    tags: [value.topic, value.layer, value.status],
    relatedBips: number === 141 ? [143, 147, 341] : number === 341 ? [340, 342, 141] : number === 342 ? [340, 341, 347] : number === 119 ? [68, 112, 347] : number === 347 ? [342, 348, 119] : number === 348 ? [342, 347, 119] : [141, 341],
    authors: number === 341 || number === 342 ? ['Pieter Wuille', 'Jonas Nick', 'Anthony Towns'] : ['Bitcoin BIP contributors'],
    created,
    content: '',
    sourceUrl: source(number, 'Source', '').url,
    activated: value.status === 'Deployed' ? (number >= 340 ? '2021-11-14' : number >= 140 ? '2017-08-24' : '2016-07-04') : undefined,
    citations: [source(number, 'Abstract', value.summary), source(number, 'Specification', `Normative rules and rationale for BIP ${number}.`)],
    generationStatus: 'reviewed',
  };
});

export const timeline: TimelineItem[] = [
  { bipNumber: 34, date: '2012-03', year: '2012', label: 'Block height commitment', title: 'Coinbase height', summary: 'BIP34 begins the modern version-bit era.', plainImpact: 'Made every block’s coinbase unique, fixing a quiet source of confusion for early wallets.', status: 'Deployed', relatedBips: [66] },
  { bipNumber: 66, date: '2015-07', year: '2015', label: 'Signature rules', title: 'Strict DER', summary: 'Signature encoding becomes consensus-strict.', plainImpact: 'Closed a loophole that let transaction IDs be changed without changing what the transaction did.', status: 'Deployed', relatedBips: [34, 68] },
  { bipNumber: 68, date: '2016-07', year: '2016', label: 'Relative timelocks', title: 'Sequence locks', summary: 'A coordinated timelock upgrade lands.', plainImpact: 'Gave transactions a way to say "wait N blocks," a key building block for payment channels.', status: 'Deployed', relatedBips: [112, 113] },
  { bipNumber: 141, date: '2017-08', year: '2017', label: 'SegWit activation', title: 'Witness data', summary: 'Malleability fixes and block weight activate.', plainImpact: 'Fixed a long-standing malleability problem and effectively grew block capacity without a hard fork.', status: 'Deployed', relatedBips: [143, 147, 341] },
  { bipNumber: 341, date: '2021-11', year: '2021', label: 'Taproot activation', title: 'Taproot', summary: 'Schnorr, MAST, and Tapscript activate together.', plainImpact: 'Let complex spending conditions look just like an ordinary single-signature payment when everyone cooperates.', status: 'Deployed', relatedBips: [340, 342] },
  { bipNumber: 119, date: 'Research', year: 'Ongoing', label: 'Proposal review', title: 'CTV', summary: 'A focused covenant design remains under review.', plainImpact: 'Would let coins be locked so they can only later be spent in one pre-agreed way.', status: 'Draft', relatedBips: [68, 112, 347] },
  { bipNumber: 347, date: 'Research', year: 'Ongoing', label: 'Proposal review', title: 'OP_CAT', summary: 'Bounded concatenation is being explored.', plainImpact: 'Would bring back a simple, general-purpose opcode that could enable vaults and other constructions.', status: 'Draft', relatedBips: [342, 348, 119] },
];

export const sentimentByBip: Record<number, SentimentData> = Object.fromEntries(bips.map((bip) => [bip.number, {
  bipNumber: bip.number,
  against: bip.status === 'Draft' ? 18 : 6,
  neutral: bip.status === 'Draft' ? 34 : 12,
  for: bip.status === 'Draft' ? 48 : 82,
  totalVotes: bip.status === 'Draft' ? 128 : 246,
  totalSats: bip.status === 'Draft' ? 1280 : 2460,
  score: bip.status === 'Draft' ? 30 : 76,
  mode: 'llm',
  scoreBasis: 'notes',
  hasSignal: true,
  hasDirection: true,
  directionNote: 'Direction comes from classified Nostr posts.',
  satsScore: null,
  voteScore: bip.status === 'Draft' ? 30 : 76,
  degraded: false,
  totalSatsFor: bip.status === 'Draft' ? 900 : 2200,
  totalSatsAgainst: bip.status === 'Draft' ? 380 : 260,
  counts: {
    favour: bip.status === 'Draft' ? 61 : 202,
    against: bip.status === 'Draft' ? 23 : 15,
    neutral: bip.status === 'Draft' ? 44 : 29,
  },
  sampleSize: bip.status === 'Draft' ? 128 : 246,
  uniqueVoters: bip.status === 'Draft' ? 128 : 246,
  narrative: '',
  computedAt: Math.floor(Date.now() / 1000),
  recentNotes: [
    { author: 'npub1…7k2m', choice: 'Neutral', note: 'Promising design, but I want more implementation review before I settle on an opinion.', time: '2h' },
    { author: 'npub1…p9xq', choice: 'For', note: 'The use cases are concrete and the scope feels understandable to me.', time: '5h' },
  ],
}]));
