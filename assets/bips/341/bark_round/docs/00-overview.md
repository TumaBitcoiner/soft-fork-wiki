# 00 · Overview

## What this captures

One scenario from the [bark](https://gitlab.com/ark-bitcoin/bark) (Ark) codebase — the
**round signing ceremony** — pinned to release `server-0.4.0` and made runnable in one
command. It is built for a Bitcoin **consensus**-themed exhibit, and it tells the round
through two lenses:

1. **The three-act state machine** (`docs/02-three-acts.md`) — on the server the round is a
   typed state machine, `CollectingPayments → SigningVtxoTree → RoundFinished`. We drive a
   real round in an integration test and read the phase transitions straight out of
   `captaind`'s structured log.

2. **The consensus check** (`docs/03-libbitcoinkernel.md`) — the round produces a signed
   *tree of taproot outputs* that lives **off-chain**, so no node ever validates it in the
   happy path. bark checks it with **`libbitcoinkernel`**, Bitcoin Core's consensus engine
   compiled in-process, under the `VERIFY_ALL` flag set.

## Why it belongs in a consensus wiki

The round is a **taproot** signing ceremony end to end (BIP 340 Schnorr / MuSig2, BIP 341
Taproot, BIP 342 Tapscript — see `docs/01-why-taproot.md`). Its entire purpose is to
*pre-sign transactions cooperatively*, because Bitcoin cannot yet make an output enforce
how it is spent. A covenant soft fork — `OP_TEMPLATEHASH` (BIP 446) or CTV — would let each
output commit to its own children and collapse the ceremony into a rule the chain enforces
itself. **The ceremony is exactly what such a soft fork would replace.**

## The two commands

```sh
nix run .#trace     # a real round → its three-act state machine (from the server log)
nix run .#verify    # the signed tree → libbitcoinkernel: CONSENSUS VALID
```

See `docs/05-reproduce.md` for exact invocation, environment, timing, and expected output.

## Pinned versions

| component | version | note |
|---|---|---|
| bark | `server-0.4.0` | `gitlab.com/ark-bitcoin/bark`, server binary is `captaind` |
| bitcoind | v31.0 | nixos-25.11 ships exactly upstream's pin |
| rustc | 1.90.0 | via fenix, upstream's pin |
| PostgreSQL | 17 | `captaind`'s DB |
| bitcoinkernel | 0.2.0 | `[dev-dependencies]` of `ark-lib` → `libbitcoinkernel-sys` 0.2.0 |

Companion visual write-up: https://claude.ai/code/artifact/44502d79-ee08-4b1b-86a0-739ec7911ca9
