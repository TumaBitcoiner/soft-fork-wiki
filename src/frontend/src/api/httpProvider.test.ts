import { describe, expect, it, vi } from 'vitest';
import { httpProvider } from './httpProvider';


describe('httpProvider', () => {
  it('uses the real local BIP endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpProvider.listBips();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/bips?limit=100&offset=0',
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  it('uses the idempotent Overview generation endpoint', async () => {
    const payload = { bipNumber: 119 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpProvider.getBipOverview(119);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/api/bips/119/overview',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('uses the live LLM sentiment endpoint without a mock fallback', async () => {
    const payload = { bipNumber: 119, sampleSize: 129 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(httpProvider.getSentiment(119)).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8002/sentiment/119?mode=llm',
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  it('surfaces sentiment-service messages without falling back to mock data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: 'GEMINI_API_KEY is required.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(httpProvider.getSentiment(999))
      .rejects.toThrow('API request failed (502): GEMINI_API_KEY is required.');
    vi.unstubAllGlobals();
  });

  it('requires a BIP number for askBips', async () => {
    await expect(httpProvider.askBips({ question: 'Explain Taproot.', mode: 'Balanced' }))
      .rejects.toThrow('Select a BIP to ask about.');
  });

  it('requires a BIP number for askBipChat', async () => {
    await expect(httpProvider.askBipChat({ question: 'Explain Taproot.', mode: 'Balanced' }))
      .rejects.toThrow('Select a BIP to ask about.');
  });

  it('requires a BIP number for askBipExplain', async () => {
    await expect(httpProvider.askBipExplain({ question: 'Explain Taproot.', mode: 'Balanced' }))
      .rejects.toThrow('Select a BIP to ask about.');
  });
});
