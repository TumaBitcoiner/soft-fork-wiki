import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import {
  ArrowRight,
  BookOpen,
  Grid2X2,
  Info,
  List,
  MessageSquareText,
  Send,
  Sparkles,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react';
import {
  apiClient,
  type AskMode,
  type BipOverview,
  type SentimentChoice,
  type SourcedClaim,
} from '@/api/apiClient';
import {
  AppShell,
  AskAnswerCard,
  BipCard,
  BipMetadataPanel,
  DifficultyChip,
  EmptyState,
  ErrorState,
  NpubLoginButton,
  PageHeader,
  SentimentMeter,
  SourceChip,
  StatusChip,
  TimelineEvent,
  VoteModal,
} from '@/components/product';
import { Markdown } from '@/components/Markdown';
import { sentimentLabel, voteButtonChoiceStyle } from '@/components/productConstants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const wrap = 'mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8';

function Seo({ title, description }: { title: string; description: string }) {
  useSeoMeta({ title: `${title} · Just Ask BIPs`, description });
  return null;
}

// ---------------------------------------------------------------------------
// Explore Proposals
// ---------------------------------------------------------------------------

export function ExplorePage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [layer, setLayer] = useState('All');
  const [topic, setTopic] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [era, setEra] = useState('All');
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const query = useQuery({
    queryKey: ['bips', search, status, layer, topic, difficulty, era],
    queryFn: () => apiClient.listBips({ search, status, layer, topic, difficulty, era }),
  });

  const filters = [
    ['Status', status, setStatus, ['All', 'Draft', 'Complete', 'Deployed', 'Closed']],
    ['Layer', layer, setLayer, ['All', 'Consensus', 'Cryptography']],
    ['Topic', topic, setTopic, ['All', 'Script', 'Scaling', 'Signatures', 'Covenants', 'Privacy', 'Timelocks', 'Validation', 'Malleability']],
    ['Difficulty', difficulty, setDifficulty, ['All', 'Beginner', 'Intermediate', 'Technical']],
    ['Era', era, setEra, ['All', '2012–2013', '2014–2015', '2015–2016', '2015–2017', '2018–2021', 'Active research']],
  ] as const;

  const resetFilters = () => {
    setSearch(''); setStatus('All'); setLayer('All'); setTopic('All'); setDifficulty('All'); setEra('All');
  };

  return (
    <AppShell>
      <Seo title="Explore Proposals" description="Browse Bitcoin proposals by status, topic, and historical context. Start simple, then go deeper." />
      <main className={wrap}>
        <PageHeader
          eyebrow="Source index"
          title="Explore Proposals"
          description="Browse Bitcoin proposals by status, topic, and historical context. Start simple, then go deeper."
        />

        <div className="mt-8 rounded-xl border border-[#D8D2C4] bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, title, or concept…" className="h-10 flex-1" />
            {filters.map(([label, value, setter, options]) => (
              <Select key={label} value={value} onValueChange={setter}>
                <SelectTrigger className="w-full lg:w-40">
                  <SelectValue placeholder={label} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>{option === 'All' ? `All ${label.toLowerCase()}` : option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <span className="text-sm text-[#6B7280]">
              <SlidersHorizontal className="mr-2 inline size-4" />
              {query.data?.length ?? 0} proposals
            </span>
            <div className="flex rounded-lg border p-1">
              <Button size="sm" variant={view === 'grid' ? 'secondary' : 'ghost'} onClick={() => setView('grid')} aria-label="Card view"><Grid2X2 /></Button>
              <Button size="sm" variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')} aria-label="Table view"><List /></Button>
            </div>
          </div>
        </div>

        {query.isLoading ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="h-72 animate-pulse rounded-xl bg-white" />)}
          </div>
        ) : query.isError ? (
          <div className="mt-8"><ErrorState onRetry={() => query.refetch()} /></div>
        ) : !query.data?.length ? (
          <div className="mt-8">
            <EmptyState title="No proposals match these filters" body="No proposals match these filters. Try removing one filter." />
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={resetFilters}>Clear filters</Button>
            </div>
          </div>
        ) : view === 'grid' ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {query.data.map((bip) => <BipCard key={bip.number} bip={bip} />)}
          </div>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b bg-[#F7F8FA] text-xs uppercase tracking-wider text-[#6B7280]">
                <tr>
                  <th className="p-4">BIP</th>
                  <th className="p-4">Title</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Difficulty</th>
                  <th className="p-4">In plain terms</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.map((bip) => (
                  <tr key={bip.number} className="border-b last:border-0">
                    <td className="p-4 font-mono font-bold text-[#9A4F00]">{bip.number}</td>
                    <td className="p-4 font-medium">{bip.title}</td>
                    <td className="p-4"><StatusChip status={bip.status} /></td>
                    <td className="p-4"><DifficultyChip level={bip.difficulty} /></td>
                    <td className="p-4 max-w-xs text-sm text-[#6B7280]">{bip.plainSummary}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Button asChild size="sm" variant="ghost"><Link to={`/bips/${bip.number}`}>Read</Link></Button>
                        <Button asChild size="sm" variant="ghost"><Link to={`/ask?bip=${bip.number}&origin=explore`}>Ask</Link></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Consensus Timeline
// ---------------------------------------------------------------------------

export function TimelinePage() {
  const query = useQuery({ queryKey: ['timeline'], queryFn: () => apiClient.getTimeline({}) });
  return (
    <AppShell>
      <Seo title="Consensus Timeline" description="See Bitcoin consensus history as a sequence of proposals, debates, and deployments." />
      <main className={wrap}>
        <PageHeader
          eyebrow="Consensus history"
          title="Consensus Timeline"
          description="See Bitcoin consensus history as a sequence of proposals, debates, and deployments."
        />

        {query.isLoading ? (
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => <div key={n} className="h-48 animate-pulse rounded-lg bg-white" />)}
          </div>
        ) : query.isError ? (
          <div className="mt-12"><ErrorState onRetry={() => query.refetch()} /></div>
        ) : (
          <div className="relative mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {query.data?.map((item, index) => <TimelineEvent key={`${item.bipNumber}-${item.date}`} item={item} index={index} />)}
          </div>
        )}

        <p className="mt-6 text-center text-sm text-[#6B7280]">Click any proposal to understand what changed and why it mattered.</p>

        <div className="mt-8 rounded-lg border border-[#D8D2C4] bg-[#FFFDF7] p-5 text-sm leading-6 text-[#374151]">
          <Info className="mr-2 inline size-4" />
          <strong>Timeline note:</strong> proposal dates, deployment milestones, and activation dates are different things. A BIP’s presence here does not imply endorsement or current consensus.
        </div>
      </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Ask Anything
// ---------------------------------------------------------------------------

const prompts = [
  'Explain this in plain terms.',
  'Why do people support this?',
  'Why do people oppose this?',
  'What does this change for node runners?',
  'Compare this to Taproot.',
  'What is still uncertain?',
];

export function AskPage() {
  const [params] = useSearchParams();
  const initial = params.get('q') ?? '';
  const origin = params.get('origin');
  const bipNumber = Number(params.get('bip')) || undefined;
  const [question, setQuestion] = useState(initial);
  const [mode, setMode] = useState<AskMode>('Balanced');
  const mutation = useMutation({
    mutationFn: async (payload: { question: string; mode: AskMode; bipNumber?: number }) => {
      if (origin === 'explore') {
        return apiClient.askBipExplain(payload);
      }

      const [chat, explain] = await Promise.all([
        apiClient.askBipChat(payload),
        apiClient.askBipExplain(payload),
      ]);

      return {
        ...chat,
        inPlainTerms: explain.inPlainTerms,
        whatBipsSay: '',
      };
    },
  });

  useEffect(() => {
    if (initial && !mutation.data && !mutation.isPending) mutation.mutate({ question: initial, mode, bipNumber });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (text = question) => {
    if (text.trim()) {
      setQuestion(text);
      mutation.mutate({ question: text, mode, bipNumber });
    }
  };

  return (
    <AppShell>
      <Seo title="Ask Anything" description="No question is too basic. Answers are grounded in BIP source material and show citations." />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <PageHeader
          eyebrow="Ask anything"
          title="Ask anything about a Bitcoin proposal."
          description="No question is too basic. Answers are grounded in BIP source material and show citations."
        />

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-medium">Answer mode</span>
          {(['Simple', 'Balanced', 'Technical'] as AskMode[]).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={mode === item ? 'default' : 'outline'}
              className={mode === item ? 'bg-[#F7931A]' : ''}
              onClick={() => setMode(item)}
            >
              {item}
            </Button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[#D8D2C4] bg-white p-3 shadow-sm">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything. Seriously. No question is too basic."
            className="min-h-28 resize-none border-0 text-lg shadow-none focus-visible:ring-0"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          />
          <div className="flex items-center justify-between border-t p-2 pt-3">
            <span className="text-xs text-[#6B7280]">Ctrl/⌘ + Enter to ask</span>
            <Button onClick={() => submit()} disabled={!question.trim() || mutation.isPending}>
              {mutation.isPending ? 'Making sense of it…' : 'Ask BIPs'} <Send />
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => submit(prompt)}
              className="rounded-sm border border-[#D8D2C4] bg-[#FFFDF7] px-3 py-2 text-left font-mono text-xs text-[#4B5563] transition hover:border-[#00A7CC] hover:text-[#075985] hover:shadow-[0_0_10px_rgba(0,209,255,.1)]"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {mutation.isPending ? (
            <div className="archive-surface rounded-lg border border-[#D8D2C4] p-6">
              <div className="h-4 w-36 animate-pulse rounded bg-gray-200" />
              <div className="mt-5 h-7 w-4/5 animate-pulse rounded bg-gray-200" />
              <div className="mt-4 h-20 animate-pulse rounded bg-gray-100" />
              <p className="mt-4 text-sm text-[#6B7280]">Making sense of it…</p>
            </div>
          ) : mutation.isError && mutation.error instanceof Error && mutation.error.message === 'Select a BIP to ask about.' ? (
            <EmptyState title="Pick a BIP first" body="Choose a proposal so we know which sources to summarize." />
          ) : mutation.isError ? (
            <ErrorState onRetry={() => submit()} />
          ) : mutation.data ? (
            <>
              <div className="mb-4 flex gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#111827] text-[#F7931A]">
                  <MessageSquareText className="size-4" />
                </div>
                <div className="rounded-xl rounded-tl-none bg-[#EEF3FF] px-4 py-3 text-sm">{mutation.data.question}</div>
              </div>
              <AskAnswerCard answer={mutation.data} />
            </>
          ) : (
            <EmptyState title="Ask anything. Seriously." body="No question is too basic. Answers are grounded in the selected BIP source material." />
          )}
        </div>
      </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// BIP / Proposal Detail
// ---------------------------------------------------------------------------

const unsupportedOverviewClaim = 'No supported claim found in the analyzed BIP material.';

function ClaimCitations({ claim }: { claim: SourcedClaim }) {
  return (
    <>
      {claim.basis === 'inferred' && (
        <span className="ml-2 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Inferred
        </span>
      )}
      <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#6B7280]">
        {claim.citations.map((citation, index) => (
          <a
            key={`${citation.bipNumber}-${citation.section}-${index}`}
            href={citation.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={citation.excerpt}
            className="font-medium text-[#007C96] underline decoration-[#8BD7E7] underline-offset-2 hover:text-[#075985]"
          >
            BIP {citation.bipNumber} · {citation.section}
          </a>
        ))}
      </span>
    </>
  );
}

function ClaimList({ claims }: { claims: SourcedClaim[] }) {
  if (claims.length === 0) {
    return <p className="mt-3 text-sm leading-6 text-[#6B7280]">{unsupportedOverviewClaim}</p>;
  }
  return (
    <ul className="mt-3 space-y-4 text-sm leading-6">
      {claims.map((claim, index) => (
        <li key={`${claim.text}-${index}`} className="flex gap-2">
          <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-current opacity-60" />
          <span>
            {claim.text}
            <ClaimCitations claim={claim} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewSkeleton() {
  return (
    <div aria-label="Generating BIP Overview" className="space-y-8">
      {[160, 130, 240].map((height) => (
        <div key={height} className="animate-pulse rounded-xl border bg-white p-6">
          <div className="h-7 w-48 rounded bg-[#E5E7EB]" />
          <div className="mt-5 space-y-3">
            <div className="h-4 w-full rounded bg-[#EEF0F3]" />
            <div className="h-4 w-5/6 rounded bg-[#EEF0F3]" />
            <div className="h-4 w-2/3 rounded bg-[#EEF0F3]" />
          </div>
          <div style={{ height: Math.max(0, height - 120) }} />
        </div>
      ))}
    </div>
  );
}

export function OverviewContent({ overview }: { overview: BipOverview }) {
  const generated = new Date(overview.updatedAt);
  const generatedLabel = Number.isNaN(generated.getTime())
    ? overview.updatedAt
    : generated.toLocaleString();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B7280]">
        <span className="rounded-full border border-[#8BD7E7] bg-[#ECFAFD] px-2.5 py-1 font-semibold text-[#075985]">
          AI-generated from BIP sources
        </span>
        <span>{overview.model}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={overview.updatedAt}>{generatedLabel}</time>
        {overview.cached && <span>· cached</span>}
      </div>

      <section className="rounded-xl border border-[#BCE3C7] bg-[#F3FBF4] p-6">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-[#166534]"><Sparkles className="size-5" /> In Plain Terms</h2>
        <p className="editorial-copy mt-4 text-lg leading-8 text-[#1F3B2C]">
          {overview.inPlainTerms.text}
        </p>
        <div className="mt-2"><ClaimCitations claim={overview.inPlainTerms} /></div>
      </section>

      <section className="rounded-xl border border-[#D8D2C4] bg-white p-6">
        <h2 className="text-2xl font-semibold">What It Actually Changes</h2>
        <ClaimList claims={overview.whatItChanges} />
      </section>

      <section className="rounded-xl border border-[#D8D2C4] bg-white p-6">
        <div className="grid gap-5 md:grid-cols-3">
          <div className="rounded-lg border border-[#BCE3C7] bg-[#F3FBF4] p-4 text-[#1F3B2C]">
            <h3 className="text-sm font-semibold text-[#166534]">Claimed benefits</h3>
            <ClaimList claims={overview.benefits} />
          </div>
          <div className="rounded-lg border border-[#F5C6C6] bg-[#FDF3F3] p-4 text-[#3B1F1F]">
            <h3 className="text-sm font-semibold text-[#991B1B]">Tradeoffs and risks</h3>
            <ClaimList claims={overview.tradeoffs} />
          </div>
          <div className="rounded-lg border border-[#D8D2C4] bg-[#FAF7EF] p-4 text-[#3A382F]">
            <h3 className="text-sm font-semibold text-[#57544B]">Open questions</h3>
            <ClaimList claims={overview.openQuestions} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Related BIPs</h2>
        {overview.relatedBips.length === 0 ? (
          <p className="mt-3 text-sm text-[#6B7280]">{unsupportedOverviewClaim}</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {overview.relatedBips.map((related) => (
              <Link key={related} to={`/bips/${related}`} className="rounded-lg border bg-white p-4 font-mono font-semibold text-[#00A7CC] hover:border-[#00A7CC]">
                BIP {related} <ArrowRight className="float-right size-4" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function BipDetailPage() {
  const { bipNumber } = useParams();
  const number = Number(bipNumber);
  const query = useQuery({ queryKey: ['bip', number], queryFn: () => apiClient.getBip(number), retry: false });
  const overview = useQuery({
    queryKey: ['bip-overview', number],
    queryFn: () => apiClient.getBipOverview(number),
    enabled: Number.isInteger(number) && number >= 0,
    retry: false,
  });
  const sentiment = useQuery({ queryKey: ['sentiment', number], queryFn: () => apiClient.getSentiment(number) });

  if (query.isLoading) {
    return <AppShell><main className={wrap}><div className="h-80 animate-pulse rounded-xl bg-white" /></main></AppShell>;
  }
  if (!query.data) {
    return <AppShell><main className={wrap}><EmptyState title="Proposal not found" body="This proposal is not in the current curated demo index." /></main></AppShell>;
  }

  const bip = query.data;
  const isMarkdownSource = bip.sourceUrl?.toLowerCase().endsWith('.md') ?? false;

  return (
    <AppShell>
      <Seo title={`BIP ${bip.number}: ${bip.title}`} description={bip.plainSummary} />
      <main className={wrap}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-bold text-[#9A4F00]">BIP {bip.number}</span>
          <StatusChip status={bip.status} />
          <span className="text-sm text-[#6B7280]">{bip.layer} · {bip.topic}</span>
        </div>
        <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">{bip.title}</h1>
        {overview.data?.plainSummary.text || bip.plainSummary ? (
          <div className="mt-6 max-w-3xl">
            <p className="flex items-start gap-2 text-xl leading-8 text-[#4B5563]">
              <Sparkles className="mt-1.5 size-5 shrink-0 text-[#00A7CC]" />
              {overview.data?.plainSummary.text || bip.plainSummary}
            </p>
            {overview.data && (
              <div className="ml-7 mt-1">
                <ClaimCitations claim={overview.data.plainSummary} />
              </div>
            )}
          </div>
        ) : (
          <p className="mt-6 max-w-3xl text-base leading-7 text-[#6B7280]">
            Plain-language enrichment has not been generated yet. The complete
            primary source is available below.
          </p>
        )}
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild>
            <Link to={`/ask?bip=${bip.number}&q=${encodeURIComponent(`What should I understand about BIP ${bip.number}?`)}`}>
              <MessageSquareText /> Ask about this
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="overview" className="mt-12">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto bg-transparent">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="source">What the BIP Says</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="sentiment">Where People Stand</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
              {overview.isLoading ? (
                <OverviewSkeleton />
              ) : overview.isError ? (
                <div>
                  <ErrorState
                    onRetry={() => overview.refetch()}
                    message={
                      overview.error instanceof Error
                        ? overview.error.message
                        : 'Overview generation failed. Please try again.'
                    }
                  />
                  <p className="mt-3 text-center text-sm text-[#6B7280]">
                    The original BIP remains available in the “What the BIP Says” tab.
                  </p>
                </div>
              ) : overview.data ? (
                <OverviewContent overview={overview.data} />
              ) : (
                <EmptyState title="Overview unavailable" body={unsupportedOverviewClaim} />
              )}
              <BipMetadataPanel bip={bip} />
            </div>
          </TabsContent>

          <TabsContent value="source" className="pt-8">
            <div className="space-y-4">
              <p className="text-sm text-[#6B7280]">
                <BookOpen className="mr-1.5 inline size-4" /> What the BIP says, in its own words. Review the sources before deciding.
              </p>
              {bip.citations.map((citation) => (
                <div key={citation.id} className="rounded-xl border bg-white p-6">
                  <SourceChip citation={citation} />
                  {isMarkdownSource ? (
                    <div className="mt-4 border-l-2 border-[#00A7CC] pl-4 text-[#4B5563]">
                      <Markdown content={citation.excerpt} className="text-[15px] leading-7" />
                    </div>
                  ) : (
                    <blockquote className="mt-4 border-l-2 border-[#00A7CC] pl-4 leading-7 text-[#4B5563]">{citation.excerpt}</blockquote>
                  )}
                </div>
              ))}
              {bip.content && (
                isMarkdownSource ? (
                  <div className="max-h-[70vh] overflow-auto rounded-xl border bg-white p-6 text-[#374151]">
                    <Markdown content={bip.content} className="text-sm leading-6" />
                  </div>
                ) : (
                  <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border bg-white p-6 font-mono text-sm leading-6 text-[#374151]">
                    {bip.content}
                  </pre>
                )
              )}
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="pt-8">
            <div className="rounded-xl border bg-white p-6">
              <p className="font-mono text-sm text-[#00A7CC]">{bip.created}</p>
              <h2 className="mt-2 text-xl font-semibold">Proposal created</h2>
              {bip.activated && (
                <>
                  <div className="my-5 h-10 border-l-2 border-[#D8D2C4]" />
                  <p className="font-mono text-sm text-green-700">{bip.activated}</p>
                  <h2 className="mt-2 text-xl font-semibold">Consensus activation milestone</h2>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="sentiment" className="pt-8">
            {sentiment.isError ? (
              <ErrorState onRetry={() => sentiment.refetch()} />
            ) : sentiment.data && (
              <div className="max-w-2xl rounded-xl border bg-white p-6">
                <p className="text-sm text-[#6B7280]">Community signal only. Bitcoin consensus is not decided by votes.</p>
                <div className="mt-5"><SentimentMeter data={sentiment.data} /></div>
                <Button asChild className="mt-6" variant="outline">
                  <Link to={`/sentiment?bip=${bip.number}`}>See where people stand <ArrowRight /></Link>
                </Button>
              </div>
            )}
          </TabsContent>

        </Tabs>
      </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Where People Stand
// ---------------------------------------------------------------------------

export function SentimentPage() {
  const [params] = useSearchParams();
  const bipNumber = Number(params.get('bip')) || 119;
  const [npub, setNpub] = useState('');
  const [choice, setChoice] = useState<SentimentChoice>('Neutral');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(false);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['sentiment', bipNumber], queryFn: () => apiClient.getSentiment(bipNumber) });
  const submit = useMutation({
    mutationFn: apiClient.submitSentiment,
    onSuccess: (data) => client.setQueryData(['sentiment', bipNumber], data),
  });

  return (
    <AppShell>
      <Seo title="Where People Stand" description="Community signal only. Bitcoin consensus is not decided by votes." />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <PageHeader
          eyebrow="Community signal"
          title={`Where People Stand on BIP ${bipNumber}`}
          description="A paid, pseudonymous signal for research context — not a governance mechanism, activation poll, or measure of Bitcoin consensus."
          action={<NpubLoginButton npub={npub} onLogin={setNpub} />}
        />

        <div className="mt-8 rounded-lg border border-[#D8D2C4] border-l-4 border-l-[#DC2626] bg-[#FFFDF7] p-4 text-sm font-medium text-[#7F1D1D]">
          Community signal only. Bitcoin consensus is not decided by votes.
        </div>

        {query.isLoading ? (
          <div className="mt-8 h-72 animate-pulse rounded-xl bg-white" />
        ) : query.isError ? (
          <div className="mt-8"><ErrorState onRetry={() => query.refetch()} /></div>
        ) : query.data && (query.data.totalVotes === 0 ? (
          <div className="mt-8"><EmptyState title="No one has weighed in yet." body="No one has weighed in yet. Be the first to add a signal." /></div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="archive-surface rounded-lg border border-[#D8D2C4] p-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-[#6B7280]">Current mood score</p>
                  <p className="mt-1 text-4xl font-semibold">{query.data.score > 0 ? '+' : ''}{query.data.score}</p>
                </div>
                <div className="text-right text-sm text-[#6B7280]">
                  <p><strong className="text-[#111827]">{query.data.totalVotes}</strong> signals</p>
                  <p><strong className="text-[#111827]">{query.data.totalSats.toLocaleString()}</strong> sats contributed</p>
                </div>
              </div>
              <div className="mt-7"><SentimentMeter data={query.data} /></div>

              <h2 className="mt-10 flex items-center gap-2 text-lg font-semibold"><Users className="size-4 text-[#00A7CC]" /> Recent notes</h2>
              <div className="mt-4 space-y-3">
                {query.data.recentNotes.map((item, index) => (
                  <div key={`${item.author}-${index}`} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-[#6B7280]">{item.author}</span>
                      <span className={cn(
                        'font-semibold',
                        item.choice === 'For' ? 'text-green-700' : item.choice === 'Against' ? 'text-red-700' : 'text-gray-600',
                      )}>
                        {sentimentLabel[item.choice]} · {item.time}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <aside className="h-fit archive-surface rounded-lg border border-[#D8D2C4] p-6">
              <h2 className="text-xl font-semibold">Add your signal</h2>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                Your 10 sats signal helps show where the community stands. It does not decide Bitcoin consensus.
              </p>
              <div className="mt-5 grid gap-2">
                {(['For', 'Neutral', 'Against'] as SentimentChoice[]).map((item) => (
                  <button
                    key={item}
                    data-selected={choice === item}
                    onClick={() => setChoice(item)}
                    className={cn(
                      'w-full rounded-md border border-[#D8D2C4] bg-white px-3 py-2 text-left text-sm font-medium transition',
                      voteButtonChoiceStyle[item],
                    )}
                  >
                    {sentimentLabel[item]}
                  </button>
                ))}
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-4"
                placeholder="Why do you see it this way?"
              />
              <Button
                className="mt-4 w-full bg-[#F7931A] text-[#111827] hover:bg-[#E9850A]"
                disabled={!npub}
                onClick={() => setModal(true)}
              >
                <Zap /> Add your signal — 10 sats
              </Button>
              {!npub && <p className="mt-2 text-center text-xs text-[#6B7280]">Use mock npub login first.</p>}
            </aside>
          </div>
        ))}

        <VoteModal open={modal} onOpenChange={setModal} choice={choice} onConfirm={() => submit.mutate({ bipNumber, choice, note, npub })} />
      </main>
    </AppShell>
  );
}
