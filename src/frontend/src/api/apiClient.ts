import type { ApiProvider } from './types';
import { httpProvider } from './httpProvider';
import { mockProvider } from './mockProvider';

const mode = import.meta.env.VITE_DATA_MODE ?? 'http';

if (mode !== 'http' && mode !== 'mock') {
  throw new Error(`Unsupported VITE_DATA_MODE "${mode}". Use "http" or "mock".`);
}

export const apiClient: ApiProvider = mode === 'mock' ? mockProvider : httpProvider;
export type * from './types';
