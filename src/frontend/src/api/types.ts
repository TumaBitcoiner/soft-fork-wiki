export type BipStatus =
  | 'Draft'
  | 'Proposed'
  | 'Complete'
  | 'Final'
  | 'Active'
  | 'Deployed'
  | 'Closed'
  | 'Rejected'
  | 'Withdrawn'
  | 'Replaced'
  | 'Unknown';
export type AskMode = 'Simple' | 'Balanced' | 'Technical';
export type SentimentChoice = 'Against' | 'Neutral' | 'For';
export type DifficultyLevel = 'Beginner' | 'Intermediate' | 'Advanced';
export type CoverageTier = 'Strong' | 'Partial' | 'Weak';

export interface Citation {
  id: string;
  label: string;
  section: string;
  url: string;
  excerpt: string;
}

export interface Bip {
  number: number;
  title: string;
  status: BipStatus;
  layer: string;
  topic: string;
  era: string;
  difficulty: DifficultyLevel;
  /** One-line, no-jargon summary used on cards and lists. */
  plainSummary: string;
  summary: string;
  /** A short, friendly explanation of the proposal, written like a smart friend would explain it. */
  inPlainTerms: string;
  /** Concrete, concise bullet points describing what actually changes. */
  whatItChanges: string[];
  /** Neutral steelman of the strongest supportive arguments. */
  caseFor: string[];
  /** Neutral steelman of the strongest concerns. */
  caseAgainst: string[];
  /** Open questions, uncertainty, and ambiguity that remain unresolved. */
  stillUnclear: string[];
  whyItMatters: string;
  whatChanged: string;
  risks: string;
  tags: string[];
  relatedBips: number[];
  authors: string[];
  created?: string;
  type?: string;
  discussion?: string;
  license?: string;
  content: string;
  sourceUrl?: string;
  activated?: string;
  citations: Citation[];
  generationStatus: 'missing' | 'ai-generated' | 'reviewed';
}

export interface BipOverviewCitation {
  bipNumber: number;
  section: string;
  excerpt: string;
  sourceUrl: string;
}

export interface SourcedClaim {
  text: string;
  basis: 'stated' | 'inferred';
  citations: BipOverviewCitation[];
}

export interface BipOverview {
  bipNumber: number;
  plainSummary: SourcedClaim;
  inPlainTerms: SourcedClaim;
  whatItChanges: SourcedClaim[];
  benefits: SourcedClaim[];
  tradeoffs: SourcedClaim[];
  openQuestions: SourcedClaim[];
  relatedBips: number[];
  analyzedBips: number[];
  generationStatus: 'ai-generated';
  model: string;
  promptVersion: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
  cached: boolean;
}

export interface ListBipsParams {
  search?: string;
  status?: string;
  layer?: string;
  topic?: string;
  difficulty?: string;
  era?: string;
  limit?: number;
  offset?: number;
}

export interface AskPayload {
  question: string;
  mode: AskMode;
  bipNumber?: number;
}

export interface AskAnswer {
  question: string;
  shortAnswer: string;
  /** Plain-language explanation, shown before any technical detail. */
  inPlainTerms: string;
  /** What the underlying BIP source material actually says. */
  whatBipsSay: string;
  confidence: number;
  coverage: number;
  coverageTier: CoverageTier;
  citations: Citation[];
  relatedBips: number[];
  followUps: string[];
  caveat: string;
}

export interface TimelineParams {
  topic?: string;
}

export interface TimelineItem {
  bipNumber: number;
  date: string;
  year: string;
  label: string;
  title: string;
  summary: string;
  /** Plain-language description of why this moment mattered. */
  plainImpact: string;
  status: BipStatus;
  relatedBips: number[];
}

export interface SentimentNote {
  author: string;
  choice: SentimentChoice;
  note: string;
  time: string;
}

export interface SentimentData {
  bipNumber: number;
  against: number;
  neutral: number;
  for: number;
  totalVotes: number;
  totalSats: number;
  score: number;
  recentNotes: SentimentNote[];
  mode: 'llm' | 'zaps';
  scoreBasis: 'sats' | 'notes' | 'magnitude' | 'none';
  hasSignal: boolean;
  hasDirection: boolean;
  directionNote: string;
  satsScore: number | null;
  voteScore: number | null;
  degraded: boolean;
  totalSatsFor: number;
  totalSatsAgainst: number;
  counts: {
    favour: number;
    against: number;
    neutral: number;
  };
  sampleSize: number;
  uniqueVoters: number;
  narrative: string;
  computedAt: number;
  snapshot?: boolean;
}

export interface SubmitSentimentPayload {
  bipNumber: number;
  choice: SentimentChoice;
  note?: string;
  npub: string;
}

export interface ApiProvider {
  listBips(params?: ListBipsParams): Promise<Bip[]>;
  listBipMetadata(params?: ListBipsParams): Promise<Bip[]>;
  getBip(bipNumber: number): Promise<Bip>;
  getBipMetadata(bipNumber: number): Promise<Bip>;
  getBipOverview(bipNumber: number): Promise<BipOverview>;
  askBips(payload: AskPayload): Promise<AskAnswer>;
  askBipChat(payload: AskPayload): Promise<AskAnswer>;
  askBipExplain(payload: AskPayload): Promise<AskAnswer>;
  getTimeline(params?: TimelineParams): Promise<TimelineItem[]>;
  getSentiment(bipNumber: number): Promise<SentimentData>;
  submitSentiment(payload: SubmitSentimentPayload): Promise<SentimentData>;
}
