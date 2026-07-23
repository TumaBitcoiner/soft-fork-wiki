# 03 · How bark uses rust-bitcoinkernel

`rust-bitcoinkernel` is Bitcoin Core's consensus engine (`libbitcoinkernel`) exposed as a
Rust library. bark uses it as a **ground-truth consensus oracle in its tests**: "we built
this taproot spend by hand — does Bitcoin's real consensus code accept it?"

## It is test-only

`bitcoinkernel = "0.2.0"` is declared under **`[dev-dependencies]`** of `ark-lib`
(`lib/Cargo.toml`). Consequences:

- It is compiled **only** when `ark-lib`'s own tests are built, never in a running node.
- The **integration tests** (the barkd / server round tests) depend on `ark-lib` as a normal
  library, so its `#[cfg(test)]` items — including the kernel wrapper — are not compiled in.
  That is a hard Rust boundary: a dependency's `cfg(test)` code is invisible to dependents.
- `Cargo.lock`: `bitcoinkernel` → `libbitcoinkernel-sys` (the `-sys` crate that compiles and
  links the C++ `libbitcoinkernel`; this is why the flake carries `cmake` + `boost`).

## The single call site

Everything flows through one wrapper, `lib/src/test_util/mod.rs::verify_tx`:

```rust
krn::verify(
    &krn::ScriptPubkey::new(inputs[input_idx].script_pubkey.as_bytes())?,
    Some(inputs[input_idx].value.to_sat() as i64),
    &tx, input_idx,
    Some(krn::VERIFY_ALL),                                       // full consensus flags
    &krn::PrecomputedTransactionData::new(&tx, &spent_outputs)?, // taproot sighash data
)
```

## What it validates (the callers)

`verify_tx` is called from `#[cfg(test)]` code across **9 `ark-lib` modules**, either from
leaf tests or from a few shared test-helpers:

| module | what it consensus-checks |
|---|---|
| `vtxo/policy/clause.rs` | the taproot **script-path clauses**: delayed-sign, timelock-sign, delayed-timelock, hash-delay, hash-sign |
| `vtxo/policy/mod.rs` | leaf-VTXO unlock / expiry clauses |
| `tree/signed.rs` | **the round's signed VTXO tree** (`test_tree_builder`) — every hop |
| `connectors.rs` | connector transactions |
| `forfeit.rs` | forfeit txs (`verify_hark_forfeits`) |
| `offboard.rs` | offboard / forfeit finalization |
| `vtxo/validation.rs` | a VTXO state transition (`verify_transition`) |
| `arkoor/mod.rs`, `arkoor/package.rs` | out-of-round transfers (checkpoint / dust variants) |

## Board vs round

| | uses libbitcoinkernel? | where |
|---|---|---|
| **Round** | **Yes** | `tree/signed.rs::test_tree_builder` verifies every VTXO-tree tx |
| **Board** | No (only indirectly, via the generic `clause.rs` tests) | `board.rs` has no kernel test |

So the round is the flow that genuinely exercises the kernel on its own product: the signed
tree. That is what `nix run .#verify` runs. The captured output is at
[`../traces/libbitcoinkernel-round.txt`](../traces/libbitcoinkernel-round.txt).

## Why the round *needs* the kernel (and the node can't do it)

In a happy-path round, the VTXO tree is entirely **off-chain** — only the funding tx is
broadcast. So `bitcoind` never validates the tree's internal transactions. libbitcoinkernel
is the only way to get a real consensus verdict on transactions the chain never sees.
