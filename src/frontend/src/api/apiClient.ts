import type { ApiProvider } from './types';
import { httpProvider } from './httpProvider';
import { mockProvider } from './mockProvider';

const mode = import.meta.env.VITE_DATA_MODE ?? 'mock';

export const apiClient: ApiProvider = mode === 'http' ? httpProvider : mockProvider;
export type * from './types';
