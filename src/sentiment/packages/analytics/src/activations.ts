/**
 * When Bitcoin's soft forks actually activated on mainnet.
 *
 * The BIPs API stores only `created` (from the BIP header). There is no
 * activation date anywhere in the BIP format — BIP-2 defines `Created` but
 * nothing for deployment — so "how long did this take to activate?" cannot be
 * answered from the repo alone. This module supplies the missing half.
 *
 * The set is deliberately small. Only a handful of consensus changes have ever
 * activated on mainnet, so a curated table is complete rather than a sample.
 *
 * SOURCES. Every block height below is confirmed against Bitcoin Core's own
 * consensus parameters in `src/kernel/chainparams.cpp` (CMainParams):
 *
 *   consensus.BIP34Height  = 227931;
 *   consensus.BIP66Height  = 363725;
 *   consensus.BIP65Height  = 388381;
 *   consensus.CSVHeight    = 419328;
 *   consensus.SegwitHeight = 481824;
 *
 * Taproot has no height constant in chainparams; it is derived from
 * `consensus.MinBIP9WarningHeight = 711648; // taproot activation height +
 * miner confirmation window`, and 711648 - 2016 = 709632.
 *
 * P2SH (BIP-16) predates those constants — Core carries only a BIP16Exception
 * block hash — so its height is the one entry NOT confirmable from
 * chainparams. It is flagged below.
 *
 * Dates are the day the activating block was mined, in UTC. They are
 * secondary-sourced; the heights are primary. If a date matters more than a
 * year-level trend, re-derive it from the block timestamp at that height.
 */

/** One mainnet consensus activation. */
export interface SoftForkActivation {
  /** Every BIP that went live in this activation. */
  bips: readonly number[];
  /** Human name, e.g. "Taproot". */
  name: string;
  /** Mainnet block height at which the rules became active. */
  height: number;
  /** Activation date, ISO `YYYY-MM-DD`, UTC. */
  activated: string;
  /**
   * False when the height could not be confirmed from Bitcoin Core's
   * chainparams. Kept explicit so a caller can exclude weaker rows.
   */
  heightConfirmedInCore: boolean;
}

export const SOFT_FORK_ACTIVATIONS: readonly SoftForkActivation[] = [
  {
    bips: [16],
    name: "P2SH",
    height: 173805,
    activated: "2012-04-01",
    // Predates the height constants; Core stores only a BIP16Exception hash.
    heightConfirmedInCore: false,
  },
  {
    bips: [34],
    name: "Height in coinbase",
    height: 227931,
    activated: "2013-03-25",
    heightConfirmedInCore: true,
  },
  {
    bips: [66],
    name: "Strict DER signatures",
    height: 363725,
    activated: "2015-07-04",
    heightConfirmedInCore: true,
  },
  {
    bips: [65],
    name: "CHECKLOCKTIMEVERIFY",
    height: 388381,
    activated: "2015-12-14",
    heightConfirmedInCore: true,
  },
  {
    bips: [68, 112, 113],
    name: "CSV / relative timelocks",
    height: 419328,
    activated: "2016-07-04",
    heightConfirmedInCore: true,
  },
  {
    bips: [141, 143, 147],
    name: "SegWit",
    height: 481824,
    activated: "2017-08-24",
    heightConfirmedInCore: true,
  },
  {
    bips: [340, 341, 342],
    name: "Taproot",
    height: 709632,
    activated: "2021-11-14",
    heightConfirmedInCore: true,
  },
];

/** BIP number -> the activation it shipped in. Built once at module load. */
const BY_BIP: ReadonlyMap<number, SoftForkActivation> = new Map(
  SOFT_FORK_ACTIVATIONS.flatMap((a) =>
    a.bips.map((bip) => [bip, a] as const),
  ),
);

/** The activation a BIP shipped in, or null if it never activated. */
export function activationFor(
  bipNumber: number,
): SoftForkActivation | null {
  if (!Number.isFinite(bipNumber)) return null;
  return BY_BIP.get(bipNumber) ?? null;
}

/**
 * Drop-in for `AnalyticsOptions.activationDateFor`.
 *
 * Returns null for anything not in the table, which is the honest answer: a
 * BIP absent here has not activated on mainnet, so it has no elapsed time to
 * measure and must not be counted as fast.
 */
export function activationDateFor(bip: {
  number: number;
}): string | null {
  return activationFor(bip?.number)?.activated ?? null;
}
