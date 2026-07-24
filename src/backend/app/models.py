from typing import Literal, Optional

from pydantic import BaseModel, Field


BipStatus = Literal[
    "Draft",
    "Proposed",
    "Complete",
    "Final",
    "Active",
    "Deployed",
    "Closed",
    "Rejected",
    "Withdrawn",
    "Replaced",
    "Unknown",
]


class BipResponse(BaseModel):
    number: int
    title: str
    authors: list[str]
    status: BipStatus
    layer: Optional[str] = None
    type: Optional[str] = None
    created: Optional[str] = None
    discussion: Optional[str] = None
    license: Optional[str] = None
    content: str = ""
    sourceUrl: Optional[str] = None
    plainSummary: str = ""
    summary: str = ""
    inPlainTerms: str = ""
    whatItChanges: list[str] = Field(default_factory=list)
    caseFor: list[str] = Field(default_factory=list)
    caseAgainst: list[str] = Field(default_factory=list)
    stillUnclear: list[str] = Field(default_factory=list)
    whyItMatters: str = ""
    whatChanged: str = ""
    risks: str = ""
    topic: str = "Consensus"
    era: str = ""
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Advanced"
    tags: list[str] = Field(default_factory=list)
    relatedBips: list[int] = Field(default_factory=list)
    citations: list[dict[str, str]] = Field(default_factory=list)
    generationStatus: Literal["missing", "ai-generated", "reviewed"] = "missing"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: str
    bipCount: int


class RefreshResponse(BaseModel):
    changed: int


class ExplainRequest(BaseModel):
    bip_number: int


class ExplainResponse(BaseModel):
    bip_number: int
    summary: str
    model: str
    prompt_version: str
    created_at: str
    updated_at: str
    cached: bool


class AskRequest(BaseModel):
    bip_number: int
    question: str


class AskResponse(BaseModel):
    bip_number: int
    question: str
    answer: str
    model: str
    prompt_version: str
    created_at: str
    updated_at: str
    cached: bool


class LastAnswerResponse(BaseModel):
    bip_number: int
    question: str
    answer: str
    model: str
    prompt_version: str
    created_at: str
    updated_at: str
