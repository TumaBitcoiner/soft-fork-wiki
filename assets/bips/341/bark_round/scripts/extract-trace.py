#!/usr/bin/env python3
"""Extract the three-act round state-machine trace from a captaind stdout.log.

The Ark round is a typed server state machine:

    CollectingPayments  ->  SigningVtxoTree  ->  RoundFinished

Each transition emits a structured (slog) log line with a stable `slog_id`.
This script filters a captaind `stdout.log` down to those phase markers,
groups them into the three acts, and collapses consecutive repeats.

Usage:  extract-trace.py <path-to-server/stdout.log>
"""
import json
import sys

# slog_id -> which act it belongs to (in emission order within each act)
ACT_I = ["RoundStarted", "AttemptingRound", "RoundPaymentRegistered",
         "FullRound", "ReceivedRoundPayments"]
ACT_II = ["RoundFundingTxBuilt", "ConstructingRoundVtxoTree",
          "RoundVtxoSignaturesRegistered", "ReceivedRoundVtxoSignatures",
          "CreatedSignedVtxoTree"]
ACT_III = ["RoundVtxoCreated", "RoundFinished", "BroadcastRoundFundingTx"]

ACTS = [
    ("I", "CollectingPayments  (gathering the participants)", set(ACT_I)),
    ("II", "SigningVtxoTree     (signing the tree)", set(ACT_II)),
    ("III", "RoundFinished       (finished)", set(ACT_III)),
]
KEEP = set(ACT_I) | set(ACT_II) | set(ACT_III)


def load(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            sid = r.get("slog_id")
            if sid in KEEP:
                ts = r.get("timestamp", "")[11:23]  # HH:MM:SS.mmm
                rows.append((ts, sid, r.get("message", "")))
    return rows


def collapse(rows):
    """Collapse consecutive identical slog_ids into (ts, id, msg, count)."""
    out, i = [], 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j][1] == rows[i][1]:
            j += 1
        ts, sid, msg = rows[i]
        out.append((ts, sid, msg, j - i))
        i = j
    return out


def which_act(sid):
    for k, (_num, _title, ids) in enumerate(ACTS):
        if sid in ids:
            return k
    return -1


def main(path):
    rows = collapse(load(path))
    if not rows:
        print("no round phase markers found in", path)
        return
    # Print the FIRST full round only (up to and including the first
    # BroadcastRoundFundingTx), so the trace reads as one clean ceremony.
    printed_act = -1
    for ts, sid, msg, n in rows:
        act = which_act(sid)
        if act != printed_act:
            num, title, _ = ACTS[act]
            print()
            print("  === ACT %s === %s" % (num, title))
            printed_act = act
        tag = ("  x%d" % n) if n > 1 else ""
        print("  %s  %-32s%-5s %s" % (ts, sid, tag, msg[:60]))
        if sid == "BroadcastRoundFundingTx":
            break
    print()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
