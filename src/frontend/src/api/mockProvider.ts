import type { ApiProvider, AskPayload, CoverageTier, LabScenarioPayload, ListBipsParams, SentimentChoice, SubmitSentimentPayload, TimelineParams } from './types';
import { bips, sentimentByBip, timeline } from './mockData';

const wait = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

function coverageTier(score: number): CoverageTier {
  if (score >= 80) return 'Strong';
  if (score >= 55) return 'Partial';
  return 'Weak';
}

export const mockProvider: ApiProvider = {
  async listBips(params: ListBipsParams = {}) {
    await wait(120);
    const query = params.search?.toLowerCase().trim();
    const filtered = bips.filter((bip) => {
      const matchesSearch = !query || `${bip.number} ${bip.title} ${bip.summary} ${bip.tags.join(' ')}`.toLowerCase().includes(query);
      return matchesSearch
        && (!params.status || params.status === 'All' || bip.status === params.status)
        && (!params.layer || params.layer === 'All' || bip.layer === params.layer)
        && (!params.topic || params.topic === 'All' || bip.topic === params.topic)
        && (!params.difficulty || params.difficulty === 'All' || bip.difficulty === params.difficulty)
        && (!params.era || params.era === 'All' || bip.era === params.era);
    });
    const offset = params.offset ?? 0;
    return filtered.slice(offset, params.limit === undefined ? undefined : offset + params.limit);
  },
  async listBipMetadata(params: ListBipsParams = {}) {
    return mockProvider.listBips(params);
  },
  async getBip(bipNumber) {
    await wait(120);
    const bip = bips.find((item) => item.number === bipNumber);
    if (!bip) throw new Error(`BIP ${bipNumber} was not found`);
    return bip;
  },
  async getBipMetadata(bipNumber) {
    return mockProvider.getBip(bipNumber);
  },
  async askBips(payload: AskPayload) {
    await wait(700);
    const terms = payload.question.toLowerCase();
    const bip = bips.find((item) => item.number === payload.bipNumber)
      ?? bips.find((item) => terms.includes(String(item.number)) || terms.includes(item.title.toLowerCase().split(' ')[0]))
      ?? bips.find((item) => item.number === 341)!;
    const technical = payload.mode === 'Technical';
    const asksForAgainst = terms.includes('oppose') || terms.includes('against') || terms.includes('concern');
    const asksForSupport = terms.includes('support') || terms.includes('favor') || terms.includes('for it');
    const coverage = technical ? 92 : bip.status === 'Draft' ? 62 : 84;
    const tier = coverageTier(coverage);
    let whatBipsSay = bip.whatChanged;
    if (asksForAgainst) whatBipsSay = `Some people argue: ${bip.caseAgainst.join(' ')}`;
    else if (asksForSupport) whatBipsSay = `Some people argue: ${bip.caseFor.join(' ')}`;

    return {
      question: payload.question,
      shortAnswer: bip.number === 341
        ? 'Taproot lets a Bitcoin output be spent either by a single aggregated key or by revealing only the executed branch of a committed script tree.'
        : bip.plainSummary,
      inPlainTerms: bip.inPlainTerms,
      whatBipsSay,
      confidence: 86,
      coverage,
      coverageTier: tier,
      citations: bip.citations,
      relatedBips: bip.relatedBips,
      followUps: [
        `Why do people support BIP ${bip.number}?`,
        `Why do people oppose BIP ${bip.number}?`,
        `What does BIP ${bip.number} change for node runners?`,
        `What is still uncertain about BIP ${bip.number}?`,
      ],
      caveat: bip.status === 'Draft'
        ? 'This is a draft proposal. The source describes proposed behavior, not active Bitcoin consensus.'
        : tier !== 'Strong'
          ? 'This answer is only partially supported by indexed BIP source material. Review the sources before forming a final opinion.'
          : 'Source coverage is strong, but implementation history and deployment context may still reward additional primary sources.',
    };
  },
  async askBipExplain(payload: AskPayload) {
    return mockProvider.askBips(payload);
  },
  async askBipChat(payload: AskPayload) {
    return mockProvider.askBips(payload);
  },
  async getTimeline(_params: TimelineParams = {}) { await wait(120); return timeline; },
  async getSentiment(bipNumber) { await wait(120); return sentimentByBip[bipNumber] ?? sentimentByBip[119]; },
  async submitSentiment(payload: SubmitSentimentPayload) {
    await wait(500);
    const current = sentimentByBip[payload.bipNumber] ?? sentimentByBip[119];
    const counts: Record<SentimentChoice, number> = { Against: current.against, Neutral: current.neutral, For: current.for };
    counts[payload.choice] += 1;
    return {
      ...current,
      against: counts.Against,
      neutral: counts.Neutral,
      for: counts.For,
      totalVotes: current.totalVotes + 1,
      totalSats: current.totalSats + 10,
      recentNotes: [
        { author: `${payload.npub.slice(0, 9)}…`, choice: payload.choice, note: payload.note || 'No note added — just added a signal.', time: 'now' },
        ...current.recentNotes,
      ],
    };
  },
  async runLabScenario(payload: LabScenarioPayload) {
    await wait(900);
    const bip = bips.find((item) => item.number === payload.bipNumber);
    const cat = payload.bipNumber === 347;
    const valid = payload.scenarioId !== 'failure';
    const scenarioName = cat ? 'OP_CAT concatenation check' : 'CTV template commitment check';
    const expectedBehavior = cat
      ? 'Concatenate the top two stack elements and compare the result against the expected commitment.'
      : 'Recompute the transaction template hash and verify it against the script commitment.';
    return {
      status: valid ? 'passed' : 'failed',
      scenarioName,
      bipNumber: payload.bipNumber,
      inputs: payload.input,
      expectedBehavior,
      title: valid ? 'Simulated result: scenario passed' : 'Simulated result: validation failed as expected',
      explanation: cat
        ? 'The simulator concatenated two bounded stack elements and compared the result with the expected commitment.'
        : 'The simulator recomputed the transaction template hash and checked it against the script commitment.',
      logs: cat
        ? ['[stack] push 0x6a757374', '[stack] push 0x61736b', '[op] OP_CAT → 0x6a75737461736b', `[verify] ${valid ? 'equal' : 'mismatch'}`]
        : ['[tx] serialize template fields', '[hash] sha256(template)', '[script] OP_CHECKTEMPLATEVERIFY', `[verify] ${valid ? 'commitment matched' : 'commitment mismatch'}`],
      output: valid ? 'TRUE (spend accepted by simulated rules)' : 'FALSE (spend rejected by simulated rules)',
      citation: (bip ?? bips.find((item) => item.number === 347)!).citations[1],
    };
  },
};
