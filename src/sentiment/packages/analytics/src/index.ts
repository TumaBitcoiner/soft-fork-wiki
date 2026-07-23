/**
 * @soft-fork-wiki/analytics — historical analytics over BIP records.
 *
 * Pure, synchronous, dependency-free. `computeBipAnalytics` is the entry point;
 * everything else is exported so a consumer can build its own slice without
 * reimplementing the rate arithmetic or the date parsing.
 */

export * from "./types.js";
export * from "./dates.js";
export * from "./stats.js";
export * from "./normalize.js";
export * from "./groups.js";
export * from "./activation.js";
export * from "./activations.js";
export * from "./trends.js";
export * from "./analyze.js";
