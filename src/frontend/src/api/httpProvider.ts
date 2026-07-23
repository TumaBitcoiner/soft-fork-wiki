import type { ApiProvider, ListBipsParams } from './types';
import { simulationProvider } from './simulationProvider';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

/**
 * Sentiment comes from a different service to the BIPs API, so it needs its
 * own origin — `VITE_API_BASE_URL` points at the Python backend on :8000 and
 * cannot serve both. It sends permissive CORS headers, so no proxy is needed.
 */
const sentimentBaseUrl = (
  import.meta.env.VITE_SENTIMENT_BASE_URL || 'http://localhost:8002'
).replace(/\/$/, '');

export class ApiUnavailableError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available from the local HTTP backend yet.`);
    this.name = 'ApiUnavailableError';
  }
}

async function request<T>(path: string, init?: RequestInit, origin = baseUrl): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { detail?: string };
      detail = body.detail ? `: ${body.detail}` : '';
    } catch {
      // The status code remains useful when a proxy returns a non-JSON body.
    }
    throw new Error(`API request failed (${response.status})${detail}`);
  }
  return response.json() as Promise<T>;
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== 'All') {
      query.set(key, String(value));
    }
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function explorerParams(params: ListBipsParams) {
  return {
    status: params.status,
    limit: params.limit ?? 100,
    offset: params.offset ?? 0,
  };
}

function applyClientFilters<
  T extends {
    number: number;
    title: string;
    layer: string;
    topic: string;
    difficulty: string;
    era: string;
    summary: string;
    tags: string[];
  },
>(records: T[], params: ListBipsParams) {
  const search = params.search?.trim().toLowerCase();
  return records.filter((bip) => {
    const searchable = `${bip.number} ${bip.title} ${bip.summary} ${bip.tags.join(' ')}`.toLowerCase();
    return (!search || searchable.includes(search))
      && (!params.layer || params.layer === 'All' || bip.layer === params.layer)
      && (!params.topic || params.topic === 'All' || bip.topic === params.topic)
      && (!params.difficulty || params.difficulty === 'All' || bip.difficulty === params.difficulty)
      && (!params.era || params.era === 'All' || bip.era === params.era);
  });
}

const unavailable = (feature: string) => async (): Promise<never> => {
  throw new ApiUnavailableError(feature);
};

export const httpProvider: ApiProvider = {
  async listBips(params: ListBipsParams = {}) {
    const records = await request<Awaited<ReturnType<ApiProvider['listBips']>>>(
      `/api/bips${queryString(explorerParams(params))}`,
    );
    return applyClientFilters(records, params);
  },
  async listBipMetadata(params: ListBipsParams = {}) {
    const records = await request<Awaited<ReturnType<ApiProvider['listBipMetadata']>>>(
      `/api/bips/meta${queryString(explorerParams(params))}`,
    );
    return applyClientFilters(records, params);
  },
  getBip: (bipNumber) => request(`/api/bips/${bipNumber}`),
  getBipMetadata: (bipNumber) => request(`/api/bips/${bipNumber}/meta`),
  askBips: unavailable('Ask Anything'),
  getTimeline: unavailable('Timeline'),
  /**
   * Live from the sentiment service. The gauge is computed from zaps and votes
   * read off the Nostr relays — no LLM in this path, so it returns in well
   * under a second. `?mode=llm` opts into classifying public discussion
   * instead, which is slower and not what the demo uses.
   *
   * The service returns extra fields beyond SentimentData (satsScore,
   * voteScore, hasSignal, mode...). They are additive and ignored here; see
   * src/sentiment/docs/AGENTS.md before rendering the gauge, because `score`
   * is a net lean and NOT a percentage of people.
   */
  getSentiment: (bipNumber) =>
    request(`/sentiment/${bipNumber}`, undefined, sentimentBaseUrl),
  /**
   * Still unavailable, and deliberately so: recording a vote means publishing
   * a signed Nostr event, which needs the user's key. That belongs in the
   * browser via @soft-fork-wiki/voting, never on a server.
   */
  submitSentiment: unavailable('Sentiment submission'),
  runLabScenario: simulationProvider.runLabScenario,
};
