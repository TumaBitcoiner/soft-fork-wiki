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

  it('reads sentiment from the sentiment service, not the BIPs API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bipNumber: 119, against: 0, neutral: 0, for: 0,
        totalVotes: 0, totalSats: 0, score: 0, recentNotes: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpProvider.getSentiment(119);

    // Separate origin on purpose: :8000 is the Python BIPs API and cannot
    // serve this. Asserting the port guards against it being folded back in.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8002/sentiment/119',
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  it('still refuses to submit sentiment over HTTP', async () => {
    // Recording a vote publishes a signed Nostr event, which needs the user's
    // key. That belongs in the browser, never on a server — so this staying
    // unavailable is correct, not an unfinished feature.
    await expect(httpProvider.submitSentiment({
      bipNumber: 119, choice: 'For', npub: 'npub1test',
    })).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
