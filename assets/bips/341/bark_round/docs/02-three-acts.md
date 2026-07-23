# 02 · The round as a three-act state machine

On the server (`captaind`) the round is a **typed state machine** in
`server/src/round/mod.rs`. The states are literal Rust types and the transitions are method
calls:

```
CollectingPayments  --progress()-->  SigningVtxoTree  --finish()-->  RoundFinished
        ^                                   |
        +----------- restart() -------------+   (on a failed attempt: RoundFailed)
```

`RoundStateKind::{CollectingPayments, SigningVtxoTree}` name the first two; the third is the
terminal `RoundFinished`. A failed attempt calls `SigningVtxoTree::restart()`, which returns
a fresh `CollectingPayments` for the next attempt.

## The three acts and their log markers

Each transition emits a structured (`slog`) log line with a stable `slog_id`. These are the
markers you watch:

| Act | server state | `slog_id`s (in order) | meaning |
|---|---|---|---|
| **I — Gather** | `CollectingPayments` | `RoundStarted`, `AttemptingRound`, `RoundPaymentRegistered`, `FullRound`, `ReceivedRoundPayments` | open an attempt; register each participant's request until full |
| **II — Sign** | `SigningVtxoTree` | `RoundFundingTxBuilt`, `ConstructingRoundVtxoTree`, `RoundVtxoSignaturesRegistered`, `ReceivedRoundVtxoSignatures`, `CreatedSignedVtxoTree` | build the funding tx + tree; collect MuSig2 signatures; assemble the signed tree |
| **III — Finish** | `RoundFinished` | `RoundVtxoCreated`, `RoundFinished`, `BroadcastRoundFundingTx` | create the VTXOs; finalize; broadcast the one on-chain tx |

Clients see the same three phases as a **`RoundEvent`** stream (proto `bark_server.proto`):
`RoundAttempt` (Act I) → `VtxoProposal` (Act II) → `RoundFinished` (Act III), with
`RoundFailed` triggering a restart.

## Which test type shows it

- **Unit test** (`test_tree_builder`): does **not** show the state machine — it signs the
  tree directly, with no server. (It is what `docs/03` / `04` use.)
- **Integration test** (a real round through `captaind`): **does** traverse all three states
  and logs every transition.

The harness even lets a test block on a phase by type:
`srv.subscribe_log::<RoundStarted>()`, `srv.wait_for_log::<RoundFinished>()`
(`testing/src/daemon/captaind/mod.rs`, and e.g. `round_started_log_can_be_captured`).

> Note: the `full_round` test is a *cap* test — it asserts the round fills at `MAX_OUTPUTS`
> and intentionally never finishes, so it stops after `RoundVtxoSignaturesRegistered`.
> `refresh_all` (in `testing/tests/bark/round.rs`) drives a round to completion, which is
> why `nix run .#trace` uses it.

## Per-act deep dives

Each act broken down as **input → intermediate steps → output**, grounded in the code:

- [`act-1-collecting-payments.md`](act-1-collecting-payments.md) — **Act I**: participant
  registrations → the *unsigned proposed tree*.
- [`act-2-signing-vtxo-tree.md`](act-2-signing-vtxo-tree.md) — **Act II**: the unsigned tree
  → each participant's partial signatures + the forfeit exchange → the *signed tree*.
- [`act-3-round-finished.md`](act-3-round-finished.md) — **Act III**: the signed tree →
  created VTXOs + the broadcast on-chain funding tx → everyone's off-chain VTXOs.

> **Boundary precision.** The table above groups `RoundFundingTxBuilt` and
> `ConstructingRoundVtxoTree` under Act II by log timing, but in the code they are emitted
> **inside `CollectingPayments::progress()`** — the tail of Act I, building its output. The
> state-machine boundary is: Act I produces the *unsigned* tree; Act II produces the *signed*
> tree. The deep-dive docs use that (more accurate) boundary.

## The captured trace

`nix run .#trace` runs `refresh_all` with `KEEP_ALL_TEST_DATA=1`, then parses the preserved
`test/bark/refresh_all/server/stdout.log` with `scripts/extract-trace.py`. A real capture is
saved at [`../traces/round-state-machine.txt`](../traces/round-state-machine.txt):

```
  === ACT I === CollectingPayments  (gathering the participants)
  RoundStarted                     Round started
  AttemptingRound                  Initiating a round attempt
  RoundPaymentRegistered           Registered payment from a participant
  ReceivedRoundPayments            Finished collecting round payments
  === ACT II === SigningVtxoTree     (signing the tree)
  RoundFundingTxBuilt              Round funding tx built
  ConstructingRoundVtxoTree        Beginning VTXO tree construction and signing
  RoundVtxoSignaturesRegistered    Registered VTXO tree signatures from a participant
  ReceivedRoundVtxoSignatures      Finished receiving VTXO tree signatures
  CreatedSignedVtxoTree            Created the final signed VTXO tree
  === ACT III === RoundFinished       (finished)
  RoundVtxoCreated             x2  New VTXO created in round
  RoundFinished                    Round finished
  BroadcastRoundFundingTx          Broadcasted round transaction to the network
```
