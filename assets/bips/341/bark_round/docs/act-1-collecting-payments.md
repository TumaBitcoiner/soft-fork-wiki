# Act I — `CollectingPayments` (in depth)

> **Input → the participants' registrations. Output → the unsigned proposed VTXO tree.**

Act I gathers every participant's request and turns them into one **unsigned proposed
tree**: an unsigned funding transaction, the tree layout, and the aggregated signing
nonces. It is `CollectingPayments` in `server/src/round/mod.rs`, plus its `progress()`
method, which is where the output is actually built.

## Phase-boundary note (important)

The log markers `RoundFundingTxBuilt` and `ConstructingRoundVtxoTree` are emitted **inside
`CollectingPayments::progress()`** — i.e. they are the *tail of Act I* producing its output,
not the start of Act II. `progress()` returns the `SigningVtxoTree` state (Act II) already
holding the finished unsigned tree. So the clean boundary is:

```
Act I  = CollectingPayments : gather registrations  ->  build the UNSIGNED proposed tree
Act II = SigningVtxoTree    : collect signatures over that tree  ->  the SIGNED tree
```

(The captured `traces/round-state-machine.txt` groups by log timing; this doc groups by the
state machine's own boundary, which is the more precise reading.)

## INPUT

### (a) The attempt opens — `CollectingPayments::new()`

Seeds the state with:

| field | what it is |
|---|---|
| `round_data` | round parameters (max outputs, expiry, exit delta, server key, …) |
| `cosign_key` | a freshly generated **one-time server signing key** for this attempt |
| `round_attempt_challenge` | `Challenge::generate()` — anti-spam / attestation |
| `locked_inputs` | flux guard carried from the previous attempt |
| `all_inputs`, `all_outputs`, `inputs_per_cosigner` | empty accumulators |
| `round_step` | `RoundStep::AttemptInitiation` |

Logs: **`RoundStarted`**, **`AttemptingRound`** ("Initiating a round attempt").

### (b) The substantive input — each participant's registration

Delivered by the `SubmitPayment` RPC and handled by `register_payment`. Per participant:

- **input VTXOs** — the VTXOs they are spending into the round (existing VTXOs or boards).
- **`vtxo_requests: Vec<SignedVtxoRequest>`** — the *output* VTXOs they want; each request
  carries its own ephemeral **`cosign_pubkey`** (their key for signing the tree) and the
  amount / policy.
- their **MuSig2 public nonces** (`r.nonces`) for cosigning the tree nodes.
- a participation **mode**: `interactive` or `delegated` (hArk, via `unlock_preimage`).

## INTERMEDIATE steps

1. **Register each payment** — looped over every `SubmitPayment`:
   - `validate_payment_data(inputs, vtxo_requests)` — reject empty requests; check output
     amounts; **reject duplicate cosign keys** (each output's `cosign_pubkey` must be unique).
   - `check_fetch_round_input_vtxos(...)` — every input VTXO must exist, be allowed, not be
     already registered, and not be "in flux" (locked by another round or spend).
   - `register_interactive_participation` / `register_delegated_participation` — record it:
     add to `all_inputs` + `all_outputs`, map `inputs_per_cosigner[cosign_pubkey] → input_ids`,
     store the participant's nonces, and lock the inputs (flux guard).
   - Emits **`RoundPaymentRegistered`** once per participant.

2. **Close collection** — stop gathering when the round **fills** (**`FullRound`**, at
   `round_data.max_output_vtxos` = `MAX_OUTPUTS`) or the collection window elapses. Emits
   **`ReceivedRoundPayments`** ("Finished collecting round payments").

3. **`progress()` — build the output** (the hand-off to Act II):
   1. **Tree spec** — `VtxoTreeSpec::new(all_outputs, …, vec![cosign_key.public_key()], …)`:
      the binary tree of leaves from all collected requests, with the cosigner set (every
      participant `cosign_pubkey` + the server's).
   2. **Funding tx** — `FundingTxSpec { output: TxOut { script_pubkey:
      vtxos_spec.funding_tx_script_pubkey(), value: vtxos_spec.total_required_value() }, … }`,
      paid by the server's `common_round_tx_input`. → **`RoundFundingTxBuilt`**.
   3. **Server nonces** — one MuSig2 nonce pair per internal node:
      `musig::nonce_pair(&cosign_key)` → `(cosign_sec_nonces, cosign_pub_nonces)`.
   4. **Aggregate nonces** — gather each participant's public nonces from `all_outputs`, then
      `vtxos_spec.calculate_cosign_agg_nonces(user_cosign_nonces, [&cosign_pub_nonces])` →
      **`cosign_agg_nonces`** (one aggregated nonce per node). → **`ConstructingRoundVtxoTree`**.

## OUTPUT — the unsigned proposed tree

`progress()` broadcasts the proposal and returns the Act II state:

```rust
srv.rounds.broadcast_event(RoundEvent::VtxoProposal(VtxoProposal {
    round_seq,
    unsigned_round_tx: funding_tx.unsigned_tx().clone(),  // the unsigned funding transaction
    vtxos_spec:        vtxos_spec.clone(),                // the tree layout + cosigner set
    cosign_agg_nonces: cosign_agg_nonces.clone(),         // aggregated MuSig2 nonces, per node
}));
let unsigned_vtxo_tree = vtxos_spec.into_unsigned_tree(funding_tx.tree_outpoint());
// -> Ok(SigningVtxoTree { unsigned_vtxo_tree, cosign_key, cosign_sec_nonces,
//                         cosign_pub_nonces, cosign_agg_nonces, … })   // Act II
```

Log: **`SendVtxoProposal`**. Clients receive it as the `RoundEvent::VtxoProposal` on their
round subscription. So the deliverable of Act I is exactly:

| output piece | meaning |
|---|---|
| `unsigned_round_tx` | the unsigned round funding transaction |
| `vtxos_spec` | the VTXO tree layout (leaves + the aggregate cosigner set) |
| `cosign_agg_nonces` | the aggregated MuSig2 nonces, one per tree node |

Everything Act II needs to start collecting participant signatures over the tree.

## Log timeline for Act I

```
RoundStarted
AttemptingRound
RoundPaymentRegistered        (xN, one per participant)
FullRound                     (only if the round filled)
ReceivedRoundPayments
RoundFundingTxBuilt           \
ConstructingRoundVtxoTree      }  progress(): builds the unsigned proposed tree
SendVtxoProposal              /   -> transition to Act II (SigningVtxoTree)
```

## Code references

- `server/src/round/mod.rs` — `struct CollectingPayments`, `::new()`, `register_payment` /
  `validate_payment_data` / `check_fetch_round_input_vtxos` /
  `register_interactive_participation` / `register_delegated_participation`, and `progress()`.
- Types: `VtxoTreeSpec`, `FundingTxSpec`, `SignedVtxoRequest`, `VtxoParticipant`,
  `UnsignedVtxoTree`, `musig::nonce_pair`, `calculate_cosign_agg_nonces`.
- Proto: `RoundEvent`, `VtxoProposal`, `SubmitPayment`, `RoundParticipationRequest`
  (`server-rpc/protos/bark_server.proto`).
