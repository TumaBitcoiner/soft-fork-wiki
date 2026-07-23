# Act II — `SigningVtxoTree` (in depth)

> **Input → the unsigned proposed tree (from Act I). Output → the fully signed VTXO tree.**

Act II collects a partial signature from every participant over the proposed tree, adds the
server's own, and combines them into aggregate Schnorr signatures — turning the *unsigned*
tree into the *signed* tree. It is `SigningVtxoTree` in `server/src/round/mod.rs`, and its
`finish()` method is where the signatures are combined (the tail that hands off to Act III).

## INPUT — the `SigningVtxoTree` state

Returned by `CollectingPayments::progress()` (see `act-1-collecting-payments.md`):

| field | what it is |
|---|---|
| `unsigned_vtxo_tree: UnsignedVtxoTree` | the proposed tree, unsigned |
| `funding_tx: UnsignedFundingTx` | the unsigned round funding transaction |
| `cosign_key`, `cosign_sec_nonces`, `cosign_pub_nonces` | the server's one-time key + its MuSig2 nonces |
| `cosign_agg_nonces: Vec<AggregatedNonce>` | the aggregated nonce per node (from Act I) |
| `user_cosign_nonces` | each participant's public nonces |
| `cosign_part_sigs: HashMap<PublicKey, Vec<PartialSignature>>` | **empty** — filled during Act II |
| `all_inputs`, `inputs_per_cosigner`, participants, `real_outputs` | carried from Act I |

Participants receive the matching `RoundEvent::VtxoProposal` and use it to produce their
partial signatures.

## INTERMEDIATE steps

1. **Collect each participant's partial signatures** — `ProvideVtxoSignatures` RPC →
   `register_vtxo_signatures(pubkey, signatures)`:
   - de-dup (a repeat submission from the same `pubkey` is traced and ignored),
   - **verify** them: `unsigned_vtxo_tree.verify_branch_cosign_partial_sigs(...)`; invalid sigs
     are rejected (`badarg`, "invalid partial signatures"),
   - store into `cosign_part_sigs[pubkey]`,
   - emit **`RoundVtxoSignaturesRegistered`** (`nb_vtxo_signatures`, `cosigner: pubkey`),
   - when every expected signer is in, set `proceed = true` → **`ReceivedRoundVtxoSignatures`**
     ("Finished receiving VTXO tree signatures").

2. **The forfeit exchange** (`server/src/round/forfeit.rs`) — in parallel, each participant
   forfeits the **input** VTXOs they are spending, so the server can punish a double-spend:
   - `RequestForfeitNonces` → server `generate_forfeit_nonces(...)` (`HarkForfeitNonces`),
   - `ForfeitVtxos` → `register_vtxo_forfeit(...)`, which records the forfeit signatures and
     marks the inputs `SpendState::RoundForfeit`.
   This is **why the freshly minted VTXOs can safely stay off-chain**: if a client later
   double-spends a forfeited input, the server holds a signed forfeit tx to claim it.

3. **Restart on failure** — if signing cannot complete (a signer drops or a sig is bad),
   `restart()` returns a fresh `CollectingPayments` with the offending inputs disallowed
   (`disallowed_vtxos`), and the round retries as a new attempt (→ `RoundFailed`).

## OUTPUT — the signed tree (built in `finish()`)

`SigningVtxoTree::finish()` combines everything:

```rust
// 1. the server adds ITS partial signatures over the tree
let srv_cosign_sigs = self.unsigned_vtxo_tree.cosign_tree(
    &self.cosign_agg_nonces, self.cosign_sec_nonces, &self.cosign_key, ...);

// 2. combine users' + server's partials into aggregate Schnorr sigs, per node
let cosign_sigs = self.unsigned_vtxo_tree.combine_partial_signatures(
    &self.cosign_agg_nonces, &self.cosign_part_sigs, &[&srv_cosign_sigs], ...);
debug_assert_eq!(self.unsigned_vtxo_tree.verify_cosign_sigs(&cosign_sigs), Ok(()));

// 3. bake them into the tree
let signed_vtxos = create_signed_vtxo_tree(&mut self, cosign_sigs);
//   -> unsigned_vtxo_tree.into_signed_tree(cosign_sigs) : CachedSignedVtxoTree
```

Log: **`CreatedSignedVtxoTree`** ("Created the final signed VTXO tree, ready to broadcast").
The output is the **`CachedSignedVtxoTree`** — every node now carries an aggregate Schnorr
key-path signature (BIP 340 MuSig2 over BIP 341 taproot). `finish()` then proceeds into
Act III (create VTXOs, sign + broadcast the funding tx) — see `act-3-round-finished.md`.

## Log timeline for Act II

```
RoundVtxoSignaturesRegistered   (xN, one per participant)
ReceivedRoundVtxoSignatures
CreatedSignedVtxoTree           <- finish(): the signed tree (Act II output)
```
(The forfeit exchange runs alongside, driven by RequestForfeitNonces / ForfeitVtxos.)

## Code references

- `server/src/round/mod.rs` — `struct SigningVtxoTree`, `register_vtxo_signatures`,
  `restart`, `finish`, `create_signed_vtxo_tree`.
- `server/src/round/forfeit.rs` — `generate_forfeit_nonces`, `register_vtxo_forfeit`,
  `HarkForfeitNonces`.
- Types: `UnsignedVtxoTree` (`verify_branch_cosign_partial_sigs`, `cosign_tree`,
  `combine_partial_signatures`, `into_signed_tree`), `CachedSignedVtxoTree`,
  `musig::{PartialSignature, AggregatedNonce}`.
- Proto: `ProvideVtxoSignatures`, `VtxoSignaturesRequest`, `RequestForfeitNonces`,
  `ForfeitVtxos`.
