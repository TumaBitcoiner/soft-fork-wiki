# 04 · The MuSig2 signing, step by step

This is what Act II (`SigningVtxoTree` / the `ConstructingRoundVtxoTree` log line) is doing
under the hood. The unit test `lib/src/tree/signed.rs::test_tree_builder` performs the whole
ceremony directly, then consensus-checks the result — so it is the clearest reading of it.

Setup: an ephemeral **user cosign key** and **server cosign key** for the round.

1. **Build the tree shape** — `SignedTreeBuilder::new(vtxos, user_cosign_pubkey,
   unlock_preimage, expiry, server_pubkey, server_cosign_pubkey, exit_delta)`. A binary tree
   of P2TR outputs; leaves are the requested VTXOs, the root is the funding output. (BIP 341)

2. **Nonces for every node** — `set_utxo(utxo)` → `generate_user_nonces(user_cosign_key)` →
   `user_pub_nonces()`: MuSig2 **public nonces** for each node the user must cosign. (BIP 340)

3. **Server cosigns the whole tree** — `new_for_cosign(…, user_pub_nonces)` →
   `server_cosign(server_cosign_key)`: the server's **MuSig2 partial signatures** across all
   nodes at once.

4. **Verify & aggregate → signed tree** — `verify_cosign_response()` →
   `build_tree(cosign, user_cosign_key)` combines nonces + partials into **aggregate Schnorr
   signatures per node**, producing the fully-signed VTXO tree. (BIP 341 key-path)

5. **Cosign the leaves** — for each leaf VTXO: `LeafVtxoCosignContext::new()` →
   `LeafVtxoCosignResponse::new_cosign()` → `finalize()`.

6. **Forfeit the inputs (the security step)** — in the live protocol each participant signs
   **forfeit txs** for the VTXOs they are spending (`RequestForfeitNonces` → `ForfeitVtxos`),
   handing the server a way to punish a double-spend. This is *why* the freshly-minted VTXOs
   can safely stay off-chain.

7. **Broadcast** — the server aggregates everything and publishes the single round funding
   transaction (`RoundFinished` / `BroadcastRoundFundingTx`). Everyone now holds leaf VTXOs
   off-chain.

## Same ceremony, over the wire

The client↔server RPCs (proto `bark_server.proto`) that carry this:

```
SubmitPayment            register inputs + desired outputs      (Act I)
VtxoProposal   (event)   server proposes the tree               (Act II)
ProvideVtxoSignatures    client sends its MuSig2 partial sigs    (Act II)
RequestForfeitNonces
ForfeitVtxos             client forfeits its inputs             (Act II)
RoundFinished  (event)   tree signed, round tx broadcast         (Act III)
```

## The consensus capstone

After building the signed tree, `test_tree_builder` walks funding → each internal node →
leaf and calls `verify_tx(...)` (libbitcoinkernel, `VERIFY_ALL`) on each transaction. Every
hop returns valid — see `docs/03-libbitcoinkernel.md` and
[`../traces/libbitcoinkernel-round.txt`](../traces/libbitcoinkernel-round.txt).
