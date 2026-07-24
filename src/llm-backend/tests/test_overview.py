import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from app import llm, overview
import app.main as main_module
from app.config import LlmConfig
from app.main import init_app


SOURCE_QUOTE = (
    "This proposal defines a deterministic commitment that restricts how a "
    "transaction output may be spent."
)
MOTIVATION_QUOTE = (
    "The construction permits predictable spending policies without exposing "
    "unrelated branches."
)


def _write_sources(repo_path: Path) -> None:
    repo_path.mkdir(parents=True)
    (repo_path / "bip-0119.mediawiki").write_text(
        f"""<pre>
  BIP: 119
  Title: Test proposal
</pre>

== Abstract ==
{SOURCE_QUOTE}

== Motivation ==
{MOTIVATION_QUOTE}
It explicitly references BIP 341, BIP-342, BIP 340, BIP 32, BIP 39, and BIP 44.

== Specification ==
Nodes validate the committed transaction fields before accepting the spend.
""",
        encoding="utf-8",
    )
    for number in (32, 39, 44, 340, 341, 342):
        (repo_path / f"bip-{number:04d}.mediawiki").write_text(
            f"""<pre>
  BIP: {number}
</pre>

== Abstract ==
This linked proposal provides relevant background for BIP 119.

== Examples ==
This section should not be included.
""",
            encoding="utf-8",
        )


def _draft() -> dict:
    plain_words = "Deterministic commitments restrict how a transaction output may later be spent."
    in_plain_words = (
        "This proposal adds a way for a Bitcoin output to commit in advance to "
        "selected details of a later transaction. When that output is spent, "
        "nodes compare the spending transaction with the commitment and accept "
        "it only when those details match. The document motivates this as a way "
        "to create predictable spending policies while keeping unrelated choices "
        "out of view. The description concerns validation of the committed fields "
        "and does not by itself establish deployment, adoption, or broader "
        "ecosystem outcomes."
    )
    evidence = [{"source_id": "bip-119:abstract", "quote": SOURCE_QUOTE}]
    motivation = [{"source_id": "bip-119:motivation", "quote": MOTIVATION_QUOTE}]
    return {
        "plain_summary": {
            "text": plain_words,
            "basis": "stated",
            "evidence": evidence,
        },
        "in_plain_terms": {
            "text": in_plain_words,
            "basis": "stated",
            "evidence": evidence + motivation,
        },
        "what_it_changes": [{
            "text": "Nodes validate committed transaction fields before accepting the spend.",
            "basis": "stated",
            "evidence": [{
                "source_id": "bip-119:specification",
                "quote": "Nodes validate the committed transaction fields before accepting the spend.",
            }],
        }],
        "benefits": [{
            "text": "The construction supports predictable spending policies.",
            "basis": "stated",
            "evidence": motivation,
        }],
        "tradeoffs": [],
        "open_questions": [{
            "text": "The analyzed material does not specify deployment timing.",
            "basis": "inferred",
            "evidence": evidence,
        }],
    }


def _config(tmp_path: Path, api_key: str = "test-key") -> LlmConfig:
    repo_path = tmp_path / "bitcoin-bips"
    _write_sources(repo_path)
    bips_db = tmp_path / "bips.sqlite"
    bips_db.touch()
    return LlmConfig(
        bips_repo_path=repo_path,
        bips_db_path=bips_db,
        explain_db_path=tmp_path / "overview.sqlite",
        ppq_api_key=api_key,
        ppq_model="test-model",
        prompt_version="v1",
        summary_words=250,
    )


def test_parses_markdown_and_mediawiki_sections() -> None:
    markdown = overview.parse_sections(
        "# Abstract\nMarkdown body.\n## Security considerations\nBe careful.",
        1,
        "local",
    )
    mediawiki = overview.parse_sections(
        "== Abstract ==\nWiki body.\n=== Rationale ===\nBecause.",
        2,
        "local",
    )

    assert [(section.title, section.slug) for section in markdown] == [
        ("Abstract", "abstract"),
        ("Security considerations", "security-considerations"),
    ]
    assert [(section.title, section.slug) for section in mediawiki] == [
        ("Abstract", "abstract"),
        ("Rationale", "rationale"),
    ]


def test_uses_only_first_five_explicit_references(tmp_path: Path) -> None:
    config = _config(tmp_path)
    bundle = overview.build_source_bundle(config.bips_repo_path, 119)

    assert bundle.related_bips == [341, 342, 340, 32, 39]
    assert bundle.analyzed_bips == [119, 341, 342, 340, 32, 39]
    assert 44 not in bundle.analyzed_bips
    assert all(section.title != "Examples" for section in bundle.sections)


def test_rejects_altered_quotes_unknown_sections_and_oversized_fields(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path)
    bundle = overview.build_source_bundle(config.bips_repo_path, 119)

    altered = _draft()
    altered["plain_summary"]["evidence"][0]["quote"] = "A quote not in the BIP."
    with pytest.raises(ValueError, match="quote does not exist"):
        overview.validate_overview(overview.OverviewDraft.model_validate(altered), bundle)

    unknown = _draft()
    unknown["plain_summary"]["evidence"][0]["source_id"] = "bip-999:abstract"
    with pytest.raises(ValueError, match="unknown source"):
        overview.validate_overview(overview.OverviewDraft.model_validate(unknown), bundle)

    oversized = _draft()
    oversized["plain_summary"]["text"] = "word " * 26
    with pytest.raises(ValueError, match="plain_summary"):
        overview.validate_overview(overview.OverviewDraft.model_validate(oversized), bundle)


def test_recovers_exact_source_fragment_from_mediawiki_formatted_quote(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path)
    source_path = config.bips_repo_path / "bip-0119.mediawiki"
    source_path.write_text(
        source_path.read_text(encoding="utf-8").replace(
            SOURCE_QUOTE,
            "This proposal defines a '''deterministic commitment''' that "
            "restricts how a transaction output may be spent.",
        ),
        encoding="utf-8",
    )
    bundle = overview.build_source_bundle(config.bips_repo_path, 119)
    draft_data = _draft()

    payload = overview.validate_overview(
        overview.OverviewDraft.model_validate(draft_data),
        bundle,
    )

    excerpt = payload["plainSummary"]["citations"][0]["excerpt"]
    assert excerpt == (
        "This proposal defines a '''deterministic commitment''' that "
        "restricts how a transaction output may be spent"
    )
    assert excerpt in next(
        section.content
        for section in bundle.sections
        if section.source_id == "bip-119:abstract"
    )


def test_preserves_inference_label_and_removes_rejected_optional_claim(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path)
    bundle = overview.build_source_bundle(config.bips_repo_path, 119)
    draft = overview.OverviewDraft.model_validate(_draft())
    verification = overview.VerificationDraft.model_validate({
        "approved": False,
        "rejections": [{
            "field": "open_questions",
            "index": 0,
            "reason": "Not sufficiently supported",
        }],
    })

    verified = overview.apply_verification(draft, verification)
    payload = overview.validate_overview(verified, bundle)

    assert payload["openQuestions"] == []
    assert draft.open_questions[0].basis == "inferred"


def test_verifier_can_rewrite_required_claim_using_validated_evidence(
    tmp_path: Path,
) -> None:
    config = _config(tmp_path)
    bundle = overview.build_source_bundle(config.bips_repo_path, 119)
    draft = overview.OverviewDraft.model_validate(_draft())
    replacement = (
        "This proposal lets an output commit to selected details of a later "
        "transaction. When the output is spent, nodes validate those committed "
        "fields before accepting the transaction. Its stated motivation is to "
        "support predictable spending policies without exposing unrelated "
        "branches. The analyzed text describes the commitment and validation "
        "behavior in general terms. It does not, in the cited passages, establish "
        "deployment timing, adoption expectations, or effects beyond the "
        "documented spending restrictions and validation rules."
    )
    verification = overview.VerificationDraft.model_validate({
        "approved": False,
        "rejections": [{
            "field": "in_plain_terms",
            "reason": "The original wording overstated the cited material.",
            "replacement_text": (
                f"{replacement} "
                + "Unsupported trailing wording " * 30
            ),
            "replacement_basis": "stated",
        }],
    })

    verified = overview.apply_verification(draft, verification)
    payload = overview.validate_overview(verified, bundle)

    assert payload["inPlainTerms"]["text"] == replacement
    assert payload["inPlainTerms"]["citations"]


def test_parses_json_surrounded_by_provider_commentary() -> None:
    parsed = overview.parse_json_object(
        'Here is the requested JSON:\n{"approved": true, "rejections": []}\nDone.'
    )

    assert parsed == {"approved": True, "rejections": []}


@pytest.mark.anyio
async def test_generation_cache_and_source_invalidation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _config(tmp_path)
    calls = {"generate": 0}

    async def generate(*_args) -> str:
        calls["generate"] += 1
        return json.dumps(_draft())

    async def valid_draft(*_args) -> str:
        return json.dumps(_draft())

    async def approved(*_args) -> str:
        return json.dumps({"approved": True, "rejections": []})

    monkeypatch.setattr(llm, "request_overview", generate)
    monkeypatch.setattr(llm, "request_overview_repair", valid_draft)
    monkeypatch.setattr(llm, "request_overview_verification", approved)
    app = init_app(config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        first = await client.post("/overview", json={"bip_number": 119})
        second = await client.post("/overview", json={"bip_number": 119})
        config.bips_repo_path.joinpath("bip-0119.mediawiki").write_text(
            config.bips_repo_path.joinpath("bip-0119.mediawiki").read_text()
            + "\n== Security ==\nA newly documented consideration.\n",
            encoding="utf-8",
        )
        changed = await client.post("/overview", json={"bip_number": 119})

    model_app = init_app(replace(config, ppq_model="test-model-v2"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=model_app),
        base_url="http://test",
    ) as client:
        changed_model = await client.post("/overview", json={"bip_number": 119})

    monkeypatch.setattr(main_module, "OVERVIEW_PROMPT_VERSION", "overview-v4")
    prompt_app = init_app(replace(config, ppq_model="test-model-v2"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=prompt_app),
        base_url="http://test",
    ) as client:
        changed_prompt = await client.post("/overview", json={"bip_number": 119})

    assert first.status_code == 200
    assert first.json()["cached"] is False
    assert second.json()["cached"] is True
    assert changed.json()["cached"] is False
    assert changed_model.json()["cached"] is False
    assert changed_prompt.json()["cached"] is False
    assert calls["generate"] == 4


@pytest.mark.anyio
async def test_coalesces_concurrent_overview_generation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _config(tmp_path)
    calls = {"generate": 0}

    async def generate(*_args) -> str:
        calls["generate"] += 1
        await asyncio.sleep(0.05)
        return json.dumps(_draft())

    async def approved(*_args) -> str:
        return json.dumps({"approved": True, "rejections": []})

    monkeypatch.setattr(llm, "request_overview", generate)
    monkeypatch.setattr(llm, "request_overview_verification", approved)
    app = init_app(config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        first, second = await asyncio.gather(
            client.post("/overview", json={"bip_number": 119}),
            client.post("/overview", json={"bip_number": 119}),
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert sorted([first.json()["cached"], second.json()["cached"]]) == [False, True]
    assert calls["generate"] == 1


@pytest.mark.anyio
async def test_repairs_once_and_rejects_failed_verification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _config(tmp_path)
    async def invalid(*_args) -> str:
        return "not json"

    async def repaired(*_args) -> str:
        return json.dumps(_draft())

    async def rejected(*_args) -> str:
        return json.dumps({
            "approved": False,
            "rejections": [{
                "field": "plain_summary",
                "reason": "Unsupported",
            }],
        })

    monkeypatch.setattr(llm, "request_overview", invalid)
    monkeypatch.setattr(llm, "request_overview_repair", repaired)
    monkeypatch.setattr(llm, "request_overview_verification", rejected)
    monkeypatch.setattr(llm, "request_overview_verification_repair", rejected)
    app = init_app(config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/overview", json={"bip_number": 119})

    assert response.status_code == 502
    assert "Verifier rejected required field" in response.json()["detail"]


@pytest.mark.anyio
async def test_repairs_invalid_verifier_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = _config(tmp_path)
    valid_replacement = _draft()["in_plain_terms"]["text"]

    async def generated(*_args) -> str:
        return json.dumps(_draft())

    async def invalid_verification(*_args) -> str:
        return json.dumps({
            "approved": False,
            "rejections": [{
                "field": "in_plain_terms",
                "reason": "Needs more conservative wording.",
                "replacement_text": "Too short.",
                "replacement_basis": "inferred",
            }],
        })

    async def repaired_verification(*_args) -> str:
        return json.dumps({
            "approved": False,
            "rejections": [{
                "field": "in_plain_terms",
                "reason": "Rewritten against the same evidence.",
                "replacement_text": valid_replacement,
                "replacement_basis": "inferred",
            }],
        })

    monkeypatch.setattr(llm, "request_overview", generated)
    monkeypatch.setattr(
        llm,
        "request_overview_verification",
        invalid_verification,
    )
    monkeypatch.setattr(
        llm,
        "request_overview_verification_repair",
        repaired_verification,
    )
    app = init_app(config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/overview", json={"bip_number": 119})

    assert response.status_code == 200
    assert response.json()["inPlainTerms"]["basis"] == "inferred"


@pytest.mark.anyio
async def test_missing_key_missing_bip_and_timeout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing_key_config = _config(tmp_path / "no-key", api_key="")
    app = init_app(missing_key_config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        missing_key = await client.post("/overview", json={"bip_number": 119})
        missing_bip = await client.post("/overview", json={"bip_number": 999})

    assert missing_key.status_code == 503
    assert missing_bip.status_code == 404

    timeout_config = _config(tmp_path / "timeout")
    timeout_calls = 0

    async def timeout(*_args) -> str:
        nonlocal timeout_calls
        timeout_calls += 1
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(llm, "request_overview", timeout)
    timeout_app = init_app(timeout_config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=timeout_app),
        base_url="http://test",
    ) as client:
        timed_out = await client.post("/overview", json={"bip_number": 119})
        cooldown = await client.post("/overview", json={"bip_number": 119})

    assert timed_out.status_code == 504
    assert cooldown.status_code == 504
    assert "paused for" in cooldown.json()["detail"]
    assert timeout_calls == 1
