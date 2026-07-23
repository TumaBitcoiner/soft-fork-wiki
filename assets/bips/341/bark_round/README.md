# taproot-round

**The Ark round signing ceremony, as a one-command, reproducible scenario — powered by `rust-bitcoinkernel`.**

This folder captures a single scenario from the [bark](https://gitlab.com/ark-bitcoin/bark)
(Ark) codebase and makes it runnable in one command via Nix. It shows the round
two ways:

1. **As a three-act state machine** — `CollectingPayments → SigningVtxoTree → RoundFinished` —
   captured live from `captaind`'s own structured log during a real integration test.
2. **As a consensus fact** — the signed VTXO tree that the round produces is handed to
   **`libbitcoinkernel`** (Bitcoin Core's consensus engine, compiled in-process) and
   confirmed valid under the full `VERIFY_ALL` rule set.

It exists for a Bitcoin **consensus**-themed exhibit: the round is a taproot signing
ceremony (BIP 340/341/342), and a covenant (`OP_TEMPLATEHASH` / CTV) is what would
let the chain enforce it without the ceremony at all.

## Run it

```sh
nix run .#trace     # a real round → the three-act state machine, from the server log
nix run .#verify    # the signed tree → libbitcoinkernel says CONSENSUS VALID
nix run             # both, in order
nix develop         # the trimmed toolchain, to poke by hand
```

> **First run compiles the bark workspace + `libbitcoinkernel-sys`** (~4–6 min on a
> laptop; everything is cached after). The source is copied once into
> `./.taproot-round-work/` (override with `TAPROOT_ROUND_WORK`).

## What "slimmed down" means

Upstream bark's dev-shell builds two `electrs` forks, Core Lightning, and its plugins
from source. This round scenario uses the **bitcoind RPC chain source** and no
Lightning, so the flake keeps only what's needed:

| kept | why |
|---|---|
| fenix Rust **1.90** | upstream's exact toolchain pin |
| **bitcoind** (v31.0, cached from nixpkgs) | the chain, and the round's on-chain funding tx — exactly upstream's pinned version |
| **PostgreSQL 17** | `captaind`'s database |
| clang / cmake / boost | `libbitcoinkernel-sys` (the C++ consensus lib) |
| ~~electrs, Core Lightning, plugins, wasm~~ | **dropped** — not on this path |

## Layout

```
flake.nix                     the slimmed, pinned environment + the run apps
scripts/extract-trace.py      parses captaind's slog into the three acts
traces/
  round-state-machine.txt     the captured three-act trace (real run)
  libbitcoinkernel-round.txt   the captured consensus-check output
docs/
  00-overview.md              what this is, and the consensus theme
  01-why-taproot.md           the foreword: why the round needs BIP 341 + 342
  02-three-acts.md            the state machine, with the captured trace
  03-libbitcoinkernel.md      exactly how/where bark uses rust-bitcoinkernel
  04-signing-ceremony.md      the MuSig2 signing, step by step
  05-reproduce.md             exact commands, env, and what to expect
```

## Pinned versions

- bark: `gitlab.com/ark-bitcoin/bark` tag **`server-0.4.0`**
- bitcoind **v31.0**, rustc **1.90.0**, PostgreSQL **17**
- `bitcoinkernel` **0.2.0** (a `[dev-dependencies]` of `ark-lib`) → `libbitcoinkernel-sys` 0.2.0

Companion write-up (three acts + libbitcoinkernel):
https://claude.ai/code/artifact/44502d79-ee08-4b1b-86a0-739ec7911ca9
