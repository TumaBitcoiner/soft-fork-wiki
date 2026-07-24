import { describe, expect, it, vi } from 'vitest';
import { ApiUnavailableError, httpProvider } from './httpProvider';


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

  it('does not fall back to mock sentiment in HTTP mode', async () => {
    await expect(httpProvider.getSentiment(119)).rejects.toBeInstanceOf(
      ApiUnavailableError,
    );
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
