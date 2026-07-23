from pathlib import Path

from app.ingest import build_record, parse_header


SAMPLE_BIP = """<pre>
  BIP: 119
  Layer: Consensus (soft fork)
  Title: CHECKTEMPLATEVERIFY
  Author: Jeremy Rubin <jeremy@example.com>, Example Author
  Status: Draft
  Type: Standards Track
  Created: 2020-01-06
  License: BSD-3-Clause
</pre>

==Abstract==
Example source content.
"""


def test_parse_bip_metadata() -> None:
    headers = parse_header(SAMPLE_BIP)
    record = build_record(Path("bip-0119.mediawiki"), SAMPLE_BIP)

    assert headers["title"] == "CHECKTEMPLATEVERIFY"
    assert record is not None
    assert record.bip_number == 119
    assert record.authors == [
        "Jeremy Rubin <jeremy@example.com>",
        "Example Author",
    ]
    assert record.license == "BSD-3-Clause"
    assert len(record.content_hash) == 64


def test_status_passthrough() -> None:
    record = build_record(Path("bip-0119.mediawiki"), SAMPLE_BIP)
    assert record is not None
    assert record.status == "Draft"
