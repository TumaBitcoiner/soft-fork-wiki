# 05 · Reproduce

## One command

```sh
nix run .#trace     # a real round → the three-act state machine
nix run .#verify    # the signed tree → libbitcoinkernel: CONSENSUS VALID
nix run             # both, in order
```

First run copies the pinned bark source into `./.taproot-round-work/bark` and compiles it.
Override the work dir with `TAPROOT_ROUND_WORK=/path`.

## Timing (first run, laptop)

| step | ~time | note |
|---|---|---|
| realize toolchain + bitcoind + postgres | 1–2 min | cached nixpkgs substitutes (downloads) |
| compile bark workspace | ~2 min | with warm crate cache; longer cold |
| compile `libbitcoinkernel-sys` (C++) | ~2 min | only for `.#verify` |
| run `refresh_all` (a real round) | ~30 s | spins bitcoind + postgres + captaind + N barks |
| run `test_tree_builder` | ~4 s | after the kernel is built |

Everything is cached after the first run; re-runs are seconds.

## What each app does

- **`.#trace`** — builds `captaind`/`bark`/`barkd`, then runs
  `cargo test -p ark-testing --test bark refresh_all` with `KEEP_ALL_TEST_DATA=1`, then
  parses `test/bark/refresh_all/server/stdout.log` with `scripts/extract-trace.py`.
- **`.#verify`** — runs `cargo test -p ark-lib --lib test_tree_builder -- --nocapture`.

## By hand (dev shell)

```sh
nix develop
cp -r --no-preserve=mode "$(nix eval --raw .#devShells.$(nix eval --impure --raw --expr builtins.currentSystem).default 2>/dev/null; true)" /dev/null 2>/dev/null || true
# simplest: stage the source the shellHook prints, then:
cd bark
cargo test -p ark-lib --lib test_tree_builder -- --nocapture          # libbitcoinkernel
KEEP_ALL_TEST_DATA=1 cargo test -p ark-testing --test bark refresh_all # a real round
python3 ../scripts/extract-trace.py test/bark/refresh_all/server/stdout.log
```

## Environment notes (why the slim env works)

- `CHAIN_SOURCE` is left **unset** → the test harness defaults to `BitcoinCore` (bitcoind
  RPC), so **no electrs and no Lightning daemon** are started. That is what lets the flake
  drop upstream's two `electrs` builds, Core Lightning, and its plugins.
- The harness locates daemons via env execs: `BITCOIND_EXEC`, `POSTGRES_BINS` (from Nix), and
  `CAPTAIND_EXEC` / `BARK_EXEC` / `BARKD_EXEC` (the debug binaries the flake builds).
- `bitcoinkernel-sys` needs `LIBCLANG_PATH`, a C/C++ compiler, `cmake`, and `boost` — all set
  by the flake's `envPrelude`.

## Pins

`gitlab.com/ark-bitcoin/bark` @ `server-0.4.0` · bitcoind v31.0 · rustc 1.90.0 · PostgreSQL 17
· `bitcoinkernel` 0.2.0.
