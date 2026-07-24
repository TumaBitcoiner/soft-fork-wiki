import type { ApiProvider, ListBipsParams } from './types';
import { simulationProvider } from './simulationProvider';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export class ApiUnavailableError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available from the local HTTP backend yet.`);
    this.name = 'ApiUnavailableError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
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
  async askBips(payload) {
    if (!payload.bipNumber) {
      throw new Error('Select a BIP to ask about.');
    }
    const response = await request<{
      bip_number: number;
      summary: string;
      model: string;
      prompt_version: string;
      created_at: string;
      updated_at: string;
      cached: boolean;
    }>(
      '/api/explain',
      {
        method: 'POST',
        body: JSON.stringify({ bip_number: payload.bipNumber }),
      },
    );

    const summary = (response.summary ?? '').trim();
    return {
      question: payload.question,
      shortAnswer: summary || 'No summary returned yet.',
      inPlainTerms: summary,
      whatBipsSay: '',
      confidence: 0.5,
      coverage: 0.5,
      coverageTier: 'Partial',
      citations: [],
      relatedBips: [],
      followUps: [],
      caveat: 'Generated summary without citations.',
    };
  },
  askBipExplain(payload) {
    return httpProvider.askBips(payload);
  },
  async getLatestAnswer(bipNumber) {
    try {
      const response = await request<{
        bip_number: number;
        question: string;
        answer: string;
        model: string;
        prompt_version: string;
        created_at: string;
        updated_at: string;
      }>(`/api/last-answer/${bipNumber}`);
      return {
        question: response.question,
        answer: response.answer,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('API request failed (404)')) {
        return null;
      }
      throw error;
    }
  },
  async askBipChat(payload) {
    if (!payload.bipNumber) {
      throw new Error('Select a BIP to ask about.');
    }
    const response = await request<{
      bip_number: number;
      question: string;
      answer: string;
      model: string;
      prompt_version: string;
      created_at: string;
      updated_at: string;
      cached: boolean;
    }>(
      '/api/ask',
      {
        method: 'POST',
        body: JSON.stringify({
          bip_number: payload.bipNumber,
          question: payload.question,
        }),
      },
    );

    const answer = (response.answer ?? '').trim();
    return {
      question: response.question || payload.question,
      shortAnswer: answer || 'No answer returned yet.',
      inPlainTerms: answer,
      whatBipsSay: '',
      confidence: 0.5,
      coverage: 0.5,
      coverageTier: 'Partial',
      citations: [],
      relatedBips: [],
      followUps: [],
      caveat: 'Generated answer without citations.',
    };
  },
  getTimeline: unavailable('Timeline'),
  getSentiment: unavailable('Sentiment'),
  submitSentiment: unavailable('Sentiment submission'),
  runLabScenario: simulationProvider.runLabScenario,
};
