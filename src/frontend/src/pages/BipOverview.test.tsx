import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { BipOverview } from '@/api/types';
import { OverviewContent, OverviewSkeleton } from './BipPages';


const citation = {
  bipNumber: 119,
  section: 'Motivation',
  excerpt: 'The proposal documents this exact motivation.',
  sourceUrl: 'https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki',
};

const overview: BipOverview = {
  bipNumber: 119,
  plainSummary: {
    text: 'A concise summary.',
    basis: 'stated',
    citations: [citation],
  },
  inPlainTerms: {
    text: 'A concise plain-language explanation grounded in the analyzed BIP source.',
    basis: 'stated',
    citations: [citation],
  },
  whatItChanges: [{
    text: 'Nodes apply the documented validation rule.',
    basis: 'stated',
    citations: [citation],
  }],
  benefits: [],
  tradeoffs: [],
  openQuestions: [{
    text: 'Deployment timing is not specified in the analyzed text.',
    basis: 'inferred',
    citations: [citation],
  }],
  relatedBips: [341],
  analyzedBips: [119, 341],
  generationStatus: 'ai-generated',
  model: 'test-model',
  promptVersion: 'overview-v1',
  sourceHash: 'abc123',
  createdAt: '2026-07-24T00:00:00Z',
  updatedAt: '2026-07-24T00:00:00Z',
  cached: true,
};


describe('BIP Overview', () => {
  it('shows box-level loading skeletons', () => {
    render(<OverviewSkeleton />);
    expect(screen.getByLabelText('Generating BIP Overview')).toBeInTheDocument();
  });

  it('shows source citations, inference labels, metadata, and empty states', () => {
    render(
      <MemoryRouter>
        <OverviewContent overview={overview} />
      </MemoryRouter>,
    );

    expect(screen.getByText('AI-generated from BIP sources')).toBeInTheDocument();
    expect(screen.getByText('test-model')).toBeInTheDocument();
    expect(screen.getByText('· cached')).toBeInTheDocument();
    expect(screen.getByText('Inferred')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'BIP 119 · Motivation' })[0])
      .toHaveAttribute('href', citation.sourceUrl);
    expect(screen.getAllByText(
      'No supported claim found in the analyzed BIP material.',
    )).toHaveLength(2);
    expect(screen.getByRole('link', { name: /BIP 341/ })).toHaveAttribute(
      'href',
      '/bips/341',
    );
  });
});
