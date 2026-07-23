import type { ApiProvider, ListBipsParams } from './types';
import { mockProvider } from './mockProvider';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'https://api.justaskbips.com').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '' && value !== 'All') query.set(key, String(value)); });
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

function applyClientFilters<T extends { number: number; title: string; layer: string; topic: string; difficulty: string; era: string; summary: string; tags: string[] }>(records: T[], params: ListBipsParams) {
  const search = params.search?.trim().toLowerCase();
  return records.filter((bip) => {
    const matchesSearch = !search || `${bip.number} ${bip.title} ${bip.summary} ${bip.tags.join(' ')}`.toLowerCase().includes(search);
    return matchesSearch
      && (!params.layer || params.layer === 'All' || bip.layer === params.layer)
      && (!params.topic || params.topic === 'All' || bip.topic === params.topic)
      && (!params.difficulty || params.difficulty === 'All' || bip.difficulty === params.difficulty)
      && (!params.era || params.era === 'All' || bip.era === params.era);
  });
}

// Explorer endpoints are live. Features whose backend contracts are still pending
// deliberately continue using the mock provider in HTTP mode.
export const httpProvider: ApiProvider = {
  async listBips(params: ListBipsParams = {}) {
    const records = await request<Awaited<ReturnType<ApiProvider['listBips']>>>(`/bips${queryString(explorerParams(params))}`);
    return applyClientFilters(records, params);
  },
  async listBipMetadata(params: ListBipsParams = {}) {
    const records = await request<Awaited<ReturnType<ApiProvider['listBipMetadata']>>>(`/bips/meta${queryString(explorerParams(params))}`);
    return applyClientFilters(records, params);
  },
  getBip: (bipNumber) => request(`/bips/${bipNumber}`),
  getBipMetadata: (bipNumber) => request(`/bips/${bipNumber}/meta`),
  askBips: (payload) => mockProvider.askBips(payload),
  getTimeline: (params) => mockProvider.getTimeline(params),
  getSentiment: (bipNumber) => mockProvider.getSentiment(bipNumber),
  submitSentiment: (payload) => mockProvider.submitSentiment(payload),
  runLabScenario: (payload) => mockProvider.runLabScenario(payload),
};
