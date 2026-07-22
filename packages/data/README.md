# @soft-fork-wiki/data — BIP source data + LLM explainer

**Owner: Tuma**

This package holds the source information about BIPs and the LLM "explain in
plain terms" piece.

Suggested contents:
- A machine-readable index of BIPs (number, title, status, type, authors, text URL).
- The plain-language explainer: prompt(s) + code that turns a BIP into a
  non-technical summary.

Please conform BIP records to the [`Bip` type](../shared/src/bip.ts) so the
frontend and analytics can consume them directly. When the explainer fills in
`plainSummary`, everything downstream just works.

> Drop your files in here however suits the explainer work — this README is just
> a starting point.
