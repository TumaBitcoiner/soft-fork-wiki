# 01 · Why the round needs taproot

The round re-issues many VTXOs in a single on-chain transaction by pre-signing a **tree**
of outputs. That only works because **every node in that tree is one taproot (P2TR) output
doing two contradictory jobs at once** — and taproot is precisely what lets a single output
hold both.

## One P2TR output, two spend paths

### Key-path — the happy path (BIP 341 key-path + BIP 340 Schnorr)

All relevant cosigners aggregate into a **single key** with **MuSig2** and produce **one
Schnorr signature**. The whole tree is signed through cheap, private key-path spends that
look like any other taproot output. In the code, the aggregated key for a node is built by
`lib/src/tree/signed.rs::cosign_taproot(combined_pubkey, server_pubkey, expiry_height)` and
the board equivalent `lib/src/board.rs::compute_exit_data` signs it with
`taproot_key_spend_signature_hash`.

### Script-path — the safety net (BIP 341 MAST + BIP 342 tapscript)

The same output also commits to a hidden **merkle tree of scripts** (MAST). A holder can
reveal *just* the CSV-timelocked **exit** branch to leave on-chain; nothing else about the
policy is ever shown. These branches are the `VtxoPolicy` clauses
(`lib/src/vtxo/policy/clause.rs`): `PubkeyClause`, `TimelockSignClause` (relative CSV),
absolute-timelock, and hash-lock (HTLC) variants — all tapscript. A board/leaf's exit
output is built as `VtxoPolicy::new_pubkey(user).taproot(server, exit_delta, expiry)`.

## Why pre-taproot this falls apart

Before taproot you could not pack a **multiparty cooperative spend** *and* a **per-holder
timelock exit** into one small, private output:

- Without **BIP 340** there is no key aggregation — no single-signature cooperative path
  for an arbitrary cosigner set; you would need explicit multisig in-script.
- Without **BIP 341** there is no key-path/script-path split and no MAST — every alternative
  spending condition would sit in one big script, always revealed, always paid for.
- Without **BIP 342** the exit branches have no tapscript to express the CSV timelock spend.

So `BIP 341` gives the two-path output and the key-aggregation surface, and `BIP 342` gives
the exit branch its script. Take either away and the pre-signed VTXO tree — the entire round
— cannot exist in this compact, private form.

## The through-line

The round exists to *emulate a covenant with a signing ceremony*. A real covenant
(`OP_TEMPLATEHASH` / CTV) would let each output commit to its own children directly, so the
chain enforces the structure and the multiparty ceremony disappears. That is the soft fork
the wiki catalogs; this ceremony is the status quo it would replace.
