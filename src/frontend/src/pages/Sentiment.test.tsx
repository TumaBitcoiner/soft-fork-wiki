import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SentimentData } from '@/api/apiClient';
import { DemoVotePanel, SentimentReadout } from './BipPages';

const reading: SentimentData = {
  bipNumber: 110,
  against: 20,
  neutral: 26,
  for: 54,
  totalVotes: 0,
  totalSats: 7885,
  score: 45,
  recentNotes: [],
  mode: 'llm',
  scoreBasis: 'notes',
  hasSignal: true,
  hasDirection: true,
  directionNote: 'Direction comes from classified posts.',
  satsScore: null,
  voteScore: 45,
  degraded: false,
  totalSatsFor: 7191,
  totalSatsAgainst: 694,
  counts: { favour: 63, against: 24, neutral: 31 },
  sampleSize: 118,
  uniqueVoters: 0,
  narrative: '',
  computedAt: 1_720_000_000,
};

describe('sentiment presentation', () => {
  it('uses the analyzed sample rather than in-app vote count', () => {
    render(<SentimentReadout data={reading} />);

    expect(screen.getByText(/We read 118 public Nostr posts/)).toBeInTheDocument();
    expect(screen.getByText('+45')).toBeInTheDocument();
    expect(screen.queryByText(/No Nostr discussion found/)).not.toBeInTheDocument();
  });

  it('labels bundled readings as captured rather than live', () => {
    render(<SentimentReadout data={{ ...reading, snapshot: true }} />);

    expect(screen.getByText('Captured Nostr sentiment')).toBeInTheDocument();
    expect(screen.getByText('Bundled snapshot')).toBeInTheDocument();
  });

  it('shows the deterministic no-signal state', () => {
    render(<SentimentReadout data={{ ...reading, hasSignal: false, hasDirection: false, sampleSize: 0 }} />);

    expect(screen.getByText('No Nostr discussion found')).toBeInTheDocument();
  });

  it('warns when the classified sample is thin or degraded', () => {
    render(<SentimentReadout data={{
      ...reading,
      sampleSize: 3,
      degraded: true,
      counts: { favour: 1, against: 1, neutral: 1 },
    }} />);

    expect(screen.getByText(/not enough to call a meaningful direction/)).toBeInTheDocument();
    expect(screen.getByText(/partial measurement/)).toBeInTheDocument();
  });

  it('keeps demo voting local and labels it honestly', () => {
    render(<DemoVotePanel bipNumber={110} />);

    expect(screen.getByText('Demo vote — not published to Nostr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Good for Bitcoin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Demo zap — 10 sats' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing was paid, signed, recorded, or published.',
    );
  });
});
