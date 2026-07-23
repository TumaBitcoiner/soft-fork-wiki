{
  description = "Taproot round signing ceremony: a slimmed-down, reproducible bark (Ark) scenario, powered by rust-bitcoinkernel";

  # ---------------------------------------------------------------------------
  # What this is
  #
  #   A one-command, reproducible capture of ONE scenario from the bark (Ark)
  #   codebase: the round signing ceremony, seen two ways.
  #
  #     nix run .#trace    -> run a real round and print its three-act state
  #                           machine  (CollectingPayments -> SigningVtxoTree
  #                           -> RoundFinished) straight from captaind's log.
  #     nix run .#verify   -> hand the signed VTXO tree to libbitcoinkernel
  #                           (Bitcoin Core's consensus engine) and confirm
  #                           every taproot transaction is consensus-valid.
  #     nix run            -> both, in order.
  #     nix develop        -> the trimmed toolchain, to poke at it by hand.
  #
  #   It is a *slimmed* environment: upstream bark's dev-shell also builds two
  #   electrs forks, Core Lightning, and its plugins from source. This round
  #   scenario needs none of that (bitcoind RPC chain source, no Lightning), so
  #   we keep only: fenix Rust 1.90, bitcoind (v31, exactly upstream's pin),
  #   PostgreSQL 17, and the C/C++ toolchain that libbitcoinkernel-sys needs.
  # ---------------------------------------------------------------------------

  inputs = {
    nixpkgs.url = "nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Upstream bark, pinned to the exact release this scenario was captured on.
    # flake = false: we consume the source tree, not a flake.
    bark = {
      url = "git+https://gitlab.com/ark-bitcoin/bark?ref=refs/tags/server-0.4.0";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, fenix, bark }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; config = { allowUnfree = true; }; };
        lib = pkgs.lib;

        # Match upstream bark's pinned toolchain exactly (bark flake.nix).
        rustToolchain = fenix.packages.${system}.fromToolchainName {
          name = "1.90.0";
          sha256 = "sha256-SJwZ8g0zF2WrKDVmHrVG3pD2RGoQeo24MEXnNx5FyuI=";
        };
        rust = fenix.packages.${system}.combine [
          rustToolchain.rustc
          rustToolchain.cargo
          rustToolchain.clippy
          rustToolchain.rust-src
          rustToolchain.llvm-tools
          rustToolchain.rust-std
        ];

        postgresql = pkgs.postgresql_17;
        bitcoind = pkgs.bitcoind; # nixos-25.11 ships v31.0.0 == upstream's pin

        deps = [
          rust
          bitcoind
          postgresql
          pkgs.pkg-config
          pkgs.openssl
          pkgs.protobuf
          pkgs.sqlite
          pkgs.llvmPackages.clang
          pkgs.llvmPackages.llvm
          pkgs.llvmPackages.bintools
          pkgs.cmake      # libbitcoinkernel-sys
          pkgs.gnumake    # cmake's build tool (apps don't inherit stdenv's make)
          pkgs.boost.dev  # libbitcoinkernel-sys
          pkgs.gcc
          pkgs.stdenv.cc
          pkgs.jq
          pkgs.git
          pkgs.python3
          pkgs.coreutils
        ];

        # Environment the cargo build + the test harness need.
        # CHAIN_SOURCE is left unset -> defaults to BitcoinCore (bitcoind RPC),
        # which is why no electrs / Lightning daemon is required.
        envPrelude = ''
          export LIBCLANG_PATH="${pkgs.llvmPackages.clang-unwrapped.lib}/lib/"
          export CC="${pkgs.stdenv.cc}/bin/cc"
          export CXX="${pkgs.stdenv.cc}/bin/c++"
          export AR="${pkgs.stdenv.cc}/bin/ar"
          export RANLIB="${pkgs.stdenv.cc}/bin/ranlib"
          export LD_LIBRARY_PATH="${lib.makeLibraryPath [ pkgs.gcc.cc.lib pkgs.openssl.out pkgs.sqlite postgresql.lib ]}"
          export BITCOIND_EXEC="${bitcoind}/bin/bitcoind"
          export POSTGRES_BINS="${postgresql}/bin"
        '';

        # The pinned bark source is read-only in the nix store; cargo needs a
        # writable tree. Copy it once into a work dir (override with
        # TAPROOT_ROUND_WORK). First build compiles the workspace (+ kernel).
        prepWork = ''
          WORK="''${TAPROOT_ROUND_WORK:-$PWD/.taproot-round-work}"
          mkdir -p "$WORK"
          if [ ! -e "$WORK/bark/Cargo.toml" ]; then
            echo ">> staging bark server-0.4.0 into $WORK/bark (one-time copy)..."
            cp -r --no-preserve=mode,ownership "${bark}" "$WORK/bark"
          fi
          cd "$WORK/bark"
        '';

        buildBins = ''
          echo ">> building captaind + bark + barkd (first build compiles the workspace)..."
          cargo build --quiet --bin captaind --bin bark --bin barkd
          export CAPTAIND_EXEC="$PWD/target/debug/captaind"
          export BARK_EXEC="$PWD/target/debug/bark"
          export BARKD_EXEC="$PWD/target/debug/barkd"
        '';

        verifyApp = pkgs.writeShellApplication {
          name = "taproot-round-verify";
          runtimeInputs = deps;
          text = ''
            set -euo pipefail
            ${envPrelude}
            ${prepWork}
            echo "== libbitcoinkernel: consensus-check the signed VTXO tree =="
            echo "   (test_tree_builder runs the round signing ceremony, then"
            echo "    hands every tree tx to Bitcoin Core's engine under VERIFY_ALL)"
            echo
            cargo test -p ark-lib --lib test_tree_builder -- --nocapture --test-threads=1
          '';
        };

        traceApp = pkgs.writeShellApplication {
          name = "taproot-round-trace";
          runtimeInputs = deps;
          text = ''
            set -euo pipefail
            ${envPrelude}
            ${prepWork}
            ${buildBins}
            export KEEP_ALL_TEST_DATA=1
            rm -rf test/bark/refresh_all
            echo "== running a real round (refresh_all) to drive the state machine =="
            cargo test -p ark-testing --test bark refresh_all -- --test-threads=1 >/dev/null 2>&1 || {
              echo "!! refresh_all did not pass; see output below" >&2
              cargo test -p ark-testing --test bark refresh_all -- --nocapture --test-threads=1 || true
            }
            LOG="$PWD/test/bark/refresh_all/server/stdout.log"
            echo
            echo "== three-act round state machine, parsed from captaind's log =="
            python3 ${./scripts/extract-trace.py} "$LOG"
          '';
        };

        allApp = pkgs.writeShellApplication {
          name = "taproot-round";
          runtimeInputs = [ ];
          text = ''
            set -euo pipefail
            "${traceApp}/bin/taproot-round-trace"
            echo
            "${verifyApp}/bin/taproot-round-verify"
          '';
        };
      in {
        packages.default = allApp;

        apps = {
          default = { type = "app"; program = "${allApp}/bin/taproot-round"; };
          trace   = { type = "app"; program = "${traceApp}/bin/taproot-round-trace"; };
          verify  = { type = "app"; program = "${verifyApp}/bin/taproot-round-verify"; };
        };

        devShells.default = pkgs.mkShell {
          packages = deps;
          shellHook = envPrelude + ''
            echo "taproot-round dev shell (bark server-0.4.0 pinned)."
            echo "stage the source:  cp -r --no-preserve=mode ${bark} ./bark && cd bark"
            echo "then:  cargo test -p ark-lib --lib test_tree_builder -- --nocapture"
          '';
        };
      });
}
