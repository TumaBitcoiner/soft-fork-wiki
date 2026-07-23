# Act III — `RoundFinished` (in depth)

> **Input → the signed VTXO tree (from Act II). Output → the on-chain funding tx + everyone's off-chain VTXOs.**

Act III is the back half of `SigningVtxoTree::finish()`: it turns the signed tree into real
VTXOs, signs and broadcasts the single round funding transaction, and reports the result to
every participant as `RoundEvent::RoundFinished`.

## INPUT

From the first half of `finish()` (see `act-2-signing-vtxo-tree.md`):

| input | what it is |
|---|---|
| `signed_vtxos: CachedSignedVtxoTree` | the fully signed tree (aggregate Schnorr sigs per node) |
| `funding_tx: UnsignedFundingTx` | the round funding tx, still unsigned |
| the forfeit signatures | collected in Act II — the server's leverage against double-spends |
| round + participant bookkeeping | `real_outputs`, participants, `all_inputs`, … |

## INTERMEDIATE steps

1. **Persist before broadcast** — the round and the signed funding tx are written to the
   database first (so a crash can't lose a tx that is about to hit the chain).

2. **Create the VTXOs** — the tree leaves become real, storable VTXOs (`create_vtxos`):
   for each new leaf, emit **`RoundVtxoCreated`** ("New VTXO created in round") and store it
   as an unspent VTXO. These are what each participant will hold off-chain.

3. **Sign the funding transaction** — the server signs its round-tx wallet input, producing
   the broadcastable `signed_round_tx`.

4. **Assemble the result** — build the `RoundFinished` payload:

   ```rust
   let finished = RoundFinished {
       round_seq,
       signed_funding_tx / unsigned_funding_tx,
       cosign_sigs: signed_vtxos.spec.cosign_sigs.clone(),  // the tree's aggregate sigs
       vtxos: ...,                                           // the created leaf VTXOs
   };
   ```
   Broadcast to participants as `RoundEvent::RoundFinished`. Log: **`RoundFinished`**
   ("Round finished").

## OUTPUT

1. **On-chain:** `srv.tx_nursery.broadcast_tx(signed_round_tx.tx)` publishes the **single
   round funding transaction** to the network. Log: **`BroadcastRoundFundingTx`**
   ("Broadcasted round transaction to the network and all participants").

2. **To each participant:** the `RoundEvent::RoundFinished` event carrying the signed tree
   and its `cosign_sigs`. Each participant now holds their **leaf VTXO off-chain**, backed by
   the signed VTXO tree and anchored by the one on-chain funding tx.

That is the whole point of the round: **N participants, one on-chain transaction, a tree of
off-chain VTXOs** — every node standing on taproot's two spend paths (cooperative key-path
now, unilateral script-path exit later). And because the tree lives off-chain, no node ever
validates it in the happy path — which is exactly why `test_tree_builder` hands it to
`libbitcoinkernel` (see `03-libbitcoinkernel.md`).

## Log timeline for Act III

```
RoundVtxoCreated          (xN, one per created leaf VTXO)
RoundFinished
BroadcastRoundFundingTx
```

## Code references

- `server/src/round/mod.rs` — `SigningVtxoTree::finish()`, `create_vtxos`, `struct RoundFinished`.
- `srv.tx_nursery.broadcast_tx(...)`, the persistence calls before broadcast.
- Proto: `RoundEvent::RoundFinished`, `RoundFinished` message.
