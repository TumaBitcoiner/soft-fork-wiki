import hashlib
import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field


MAX_LINKED_BIPS = 5
MAX_PROMPT_CHARS = 90_000
UNSUPPORTED_MESSAGE = "No supported claim found in the analyzed BIP material."
SECTION_KEYWORDS = (
    "abstract",
    "summary",
    "motivation",
    "specification",
    "rationale",
    "compatibility",
    "security",
    "consideration",
)
LINKED_SECTION_KEYWORDS = (
    "abstract",
    "summary",
    "motivation",
    "rationale",
)
MEDIAWIKI_HEADING_RE = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$")
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
BIP_REFERENCE_RE = re.compile(r"\bBIPs?[- ]?0*(\d{1,4})\b", re.IGNORECASE)


@dataclass(frozen=True)
class Section:
    source_id: str
    bip_number: int
    title: str
    slug: str
    content: str
    source_url: str


@dataclass(frozen=True)
class SourceBundle:
    target_bip: int
    related_bips: list[int]
    analyzed_bips: list[int]
    sections: list[Section]
    source_hash: str

    def prompt_text(self) -> str:
        chunks: list[str] = []
        used = 0
        for section in self.sections:
            header = (
                f"\n<SOURCE id=\"{section.source_id}\" bip=\"{section.bip_number}\" "
                f"section=\"{section.title}\">\n"
            )
            footer = "\n</SOURCE>\n"
            remaining = MAX_PROMPT_CHARS - used - len(header) - len(footer)
            if remaining <= 0:
                break
            body = section.content[:remaining]
            chunks.append(f"{header}{body}{footer}")
            used += len(header) + len(body) + len(footer)
        return "".join(chunks)


class EvidenceDraft(BaseModel):
    source_id: str
    quote: str


class ClaimDraft(BaseModel):
    text: str
    basis: Literal["stated", "inferred"]
    evidence: list[EvidenceDraft] = Field(min_length=1, max_length=3)


class OverviewDraft(BaseModel):
    plain_summary: ClaimDraft
    in_plain_terms: ClaimDraft
    what_it_changes: list[ClaimDraft] = Field(default_factory=list, max_length=3)
    benefits: list[ClaimDraft] = Field(default_factory=list, max_length=3)
    tradeoffs: list[ClaimDraft] = Field(default_factory=list, max_length=3)
    open_questions: list[ClaimDraft] = Field(default_factory=list, max_length=3)


class RejectionDraft(BaseModel):
    field: Literal[
        "plain_summary",
        "in_plain_terms",
        "what_it_changes",
        "benefits",
        "tradeoffs",
        "open_questions",
    ]
    index: Optional[int] = None
    reason: str
    replacement_text: Optional[str] = None
    replacement_basis: Optional[Literal["stated", "inferred"]] = None


class VerificationDraft(BaseModel):
    approved: bool
    rejections: list[RejectionDraft] = Field(default_factory=list)


class CitationResponse(BaseModel):
    bipNumber: int
    section: str
    excerpt: str
    sourceUrl: str


class SourcedClaimResponse(BaseModel):
    text: str
    basis: Literal["stated", "inferred"]
    citations: list[CitationResponse]


class OverviewResponse(BaseModel):
    bipNumber: int
    plainSummary: SourcedClaimResponse
    inPlainTerms: SourcedClaimResponse
    whatItChanges: list[SourcedClaimResponse]
    benefits: list[SourcedClaimResponse]
    tradeoffs: list[SourcedClaimResponse]
    openQuestions: list[SourcedClaimResponse]
    relatedBips: list[int]
    analyzedBips: list[int]
    generationStatus: Literal["ai-generated"]
    model: str
    promptVersion: str
    sourceHash: str
    createdAt: str
    updatedAt: str
    cached: bool


def normalize_space(value: str) -> str:
    return " ".join(value.split())


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "section"


def parse_sections(content: str, bip_number: int, source_url: str) -> list[Section]:
    sections: list[Section] = []
    current_title = "Preamble"
    current_lines: list[str] = []
    seen_slugs: dict[str, int] = {}

    def append_section() -> None:
        body = "\n".join(current_lines).strip()
        if not body:
            return
        base_slug = slugify(current_title)
        count = seen_slugs.get(base_slug, 0) + 1
        seen_slugs[base_slug] = count
        slug = base_slug if count == 1 else f"{base_slug}-{count}"
        sections.append(
            Section(
                source_id=f"bip-{bip_number}:{slug}",
                bip_number=bip_number,
                title=current_title,
                slug=slug,
                content=body,
                source_url=source_url,
            )
        )

    for line in content.splitlines():
        mediawiki_match = MEDIAWIKI_HEADING_RE.match(line.strip())
        markdown_match = MARKDOWN_HEADING_RE.match(line.strip())
        match = mediawiki_match or markdown_match
        if match:
            append_section()
            current_title = match.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)
    append_section()
    return sections


def extract_related_bips(content: str, target_bip: int) -> list[int]:
    related: list[int] = []
    for match in BIP_REFERENCE_RE.finditer(content):
        number = int(match.group(1))
        if number == target_bip or number in related:
            continue
        related.append(number)
        if len(related) == MAX_LINKED_BIPS:
            break
    return related


def find_bip_file(repo_path: Path, bip_number: int) -> Optional[Path]:
    stem = f"bip-{bip_number:04d}"
    for suffix in (".mediawiki", ".md"):
        candidate = repo_path / f"{stem}{suffix}"
        if candidate.exists():
            return candidate
    return None


def _is_relevant_section(section: Section) -> bool:
    normalized = section.title.lower()
    return any(keyword in normalized for keyword in SECTION_KEYWORDS)


def _source_url(path: Path, repo_path: Path) -> str:
    relative_path = path.resolve().relative_to(repo_path.resolve()).as_posix()
    return f"https://github.com/bitcoin/bips/blob/master/{relative_path}"


def build_source_bundle(repo_path: Path, target_bip: int) -> SourceBundle:
    target_file = find_bip_file(repo_path, target_bip)
    if not target_file:
        raise FileNotFoundError(f"BIP {target_bip} source not found")
    target_content = target_file.read_text(encoding="utf-8", errors="replace")
    source_documents = [(target_file.name, target_content)]
    related_bips = extract_related_bips(target_content, target_bip)

    target_sections = parse_sections(
        target_content,
        target_bip,
        _source_url(target_file, repo_path),
    )
    selected_sections = [
        section for section in target_sections if _is_relevant_section(section)
    ]
    if not selected_sections:
        selected_sections = target_sections

    analyzed_bips = [target_bip]
    target_reference_re = re.compile(
        rf"\bBIPs?[- ]?0*{target_bip}\b",
        re.IGNORECASE,
    )
    for related_bip in related_bips:
        linked_file = find_bip_file(repo_path, related_bip)
        if not linked_file:
            continue
        linked_content = linked_file.read_text(encoding="utf-8", errors="replace")
        linked_sections = parse_sections(
            linked_content,
            related_bip,
            _source_url(linked_file, repo_path),
        )
        relevant = [
            section
            for section in linked_sections
            if any(
                keyword in section.title.lower()
                for keyword in LINKED_SECTION_KEYWORDS
            )
            or bool(target_reference_re.search(section.content))
        ]
        if not relevant:
            continue
        analyzed_bips.append(related_bip)
        source_documents.append((linked_file.name, linked_content))
        selected_sections.extend(relevant)

    hash_input = "\n".join(
        f"{filename}\n{content}" for filename, content in source_documents
    )
    return SourceBundle(
        target_bip=target_bip,
        related_bips=related_bips,
        analyzed_bips=analyzed_bips,
        sections=selected_sections,
        source_hash=hashlib.sha256(hash_input.encode("utf-8")).hexdigest(),
    )


def parse_json_object(raw: str) -> dict:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        object_start = cleaned.find("{")
        if object_start < 0:
            raise
        parsed, _ = json.JSONDecoder().raw_decode(cleaned[object_start:])
    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")
    return parsed


def _validate_word_count(text: str, minimum: int, maximum: int, field: str) -> None:
    count = len(text.split())
    if count < minimum or count > maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} words")


def _resolve_evidence_quote(quote: str, section_content: str) -> Optional[str]:
    normalized_quote = normalize_space(quote)
    normalized_source = normalize_space(section_content)
    if normalized_quote in normalized_source:
        return normalized_quote

    token_re = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?")
    quote_tokens = [
        (match.group(0).lower(), match.start(), match.end())
        for match in token_re.finditer(normalized_quote)
    ]
    source_tokens = [
        (match.group(0).lower(), match.start(), match.end())
        for match in token_re.finditer(normalized_source)
    ]
    if not quote_tokens or not source_tokens:
        return None

    match = SequenceMatcher(
        None,
        [token[0] for token in quote_tokens],
        [token[0] for token in source_tokens],
        autojunk=False,
    ).find_longest_match()
    if match.size < 5:
        return None
    start = source_tokens[match.b][1]
    end = source_tokens[match.b + match.size - 1][2]
    exact_fragment = normalized_source[start:end]
    if len(exact_fragment) < 24:
        return None
    return exact_fragment


def _validate_claim(
    claim: ClaimDraft,
    field: str,
    sections_by_id: dict[str, Section],
    minimum_words: int = 3,
    maximum_words: int = 35,
) -> dict:
    _validate_word_count(claim.text, minimum_words, maximum_words, field)
    citations: list[dict] = []
    for evidence in claim.evidence:
        section = sections_by_id.get(evidence.source_id)
        if not section:
            raise ValueError(f"{field} cites unknown source {evidence.source_id}")
        quote = _resolve_evidence_quote(evidence.quote, section.content)
        if quote is None:
            raise ValueError(
                f"{field} quote does not exist in {evidence.source_id}"
            )
        if len(quote) < 8:
            raise ValueError(f"{field} contains an evidence quote that is too short")
        citations.append(
            {
                "bipNumber": section.bip_number,
                "section": section.title,
                "excerpt": quote,
                "sourceUrl": section.source_url,
            }
        )
    return {
        "text": normalize_space(claim.text),
        "basis": claim.basis,
        "citations": citations,
    }


def validate_overview(draft: OverviewDraft, bundle: SourceBundle) -> dict:
    sections_by_id = {section.source_id: section for section in bundle.sections}
    plain_summary = _validate_claim(
        draft.plain_summary,
        "plain_summary",
        sections_by_id,
        minimum_words=3,
        maximum_words=25,
    )
    in_plain_terms = _validate_claim(
        draft.in_plain_terms,
        "in_plain_terms",
        sections_by_id,
        minimum_words=70,
        maximum_words=110,
    )

    result = {
        "plainSummary": plain_summary,
        "inPlainTerms": in_plain_terms,
    }
    for source_field, output_field in (
        ("what_it_changes", "whatItChanges"),
        ("benefits", "benefits"),
        ("tradeoffs", "tradeoffs"),
        ("open_questions", "openQuestions"),
    ):
        claims = getattr(draft, source_field)
        result[output_field] = [
            _validate_claim(claim, f"{source_field}[{index}]", sections_by_id)
            for index, claim in enumerate(claims)
        ]
    return result


def apply_verification(
    draft: OverviewDraft,
    verification: VerificationDraft,
) -> OverviewDraft:
    if verification.approved and not verification.rejections:
        return draft
    mutable = draft.model_copy(deep=True)
    array_fields = {
        "what_it_changes",
        "benefits",
        "tradeoffs",
        "open_questions",
    }
    removals: dict[str, set[int]] = {}
    for rejection in verification.rejections:
        if rejection.field in {"plain_summary", "in_plain_terms"}:
            if not rejection.replacement_text:
                raise ValueError(
                    f"Verifier rejected required field {rejection.field}: "
                    f"{rejection.reason}"
                )
            original = getattr(mutable, rejection.field)
            setattr(
                mutable,
                rejection.field,
                original.model_copy(
                    update={
                        "text": rejection.replacement_text,
                        "basis": rejection.replacement_basis or original.basis,
                    }
                ),
            )
            continue
        if rejection.field not in array_fields or rejection.index is None:
            raise ValueError("Verifier returned an invalid rejection target")
        removals.setdefault(rejection.field, set()).add(rejection.index)

    for field, indexes in removals.items():
        claims = getattr(mutable, field)
        if any(index < 0 or index >= len(claims) for index in indexes):
            raise ValueError("Verifier returned an out-of-range rejection index")
        setattr(
            mutable,
            field,
            [claim for index, claim in enumerate(claims) if index not in indexes],
        )
    if not verification.approved and not verification.rejections:
        raise ValueError("Verifier rejected the Overview without claim details")
    return mutable
