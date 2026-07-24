import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  FileText,
  HelpCircle,
  Menu,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import type {
  AskAnswer,
  Bip,
  BipStatus,
  Citation,
  CoverageTier,
  DifficultyLevel,
  SentimentChoice,
  SentimentData,
  TimelineItem,
} from '@/api/apiClient';
import { Markdown } from '@/components/Markdown';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { sentimentLabel } from '@/components/productConstants';

const navItems = [
  ['Explore Proposals', '/explore'],
  ['Consensus Timeline', '/timeline'],
  ['Ask Anything', '/ask'],
  ['Where People Stand', '/sentiment'],
  ['How We Stay Neutral', '/method'],
];

export function TopNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-[#D8D2C4] bg-[#F6F1E7]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3 font-semibold tracking-tight" aria-label="Just Ask BIPs - Consensus Edition home">
          <img src="/images/just-ask-bips-logo.png" alt="" className="size-11 object-contain drop-shadow-[1px_2px_1px_rgba(17,24,39,.18)]" />
          <span className="font-heading leading-tight">
            Just Ask <span className="text-[#B65F00]">BIPs</span>
            <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#6B7280]">Consensus Edition</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <NavLink
              key={href}
              to={href}
              className={({ isActive }) => cn(
                'rounded-md px-3 py-2 text-sm font-medium text-[#4B5563] hover:bg-white hover:text-[#111827]',
                isActive && 'bg-white text-[#111827] shadow-sm',
              )}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden lg:block">
          <Button asChild>
            <Link to="/ask">Ask Anything <ArrowRight /></Link>
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <nav className="border-t bg-[#F6F1E7] p-4 lg:hidden">
          {navItems.map(([label, href]) => (
            <NavLink key={href} to={href} onClick={() => setOpen(false)} className="block rounded-lg px-4 py-3 font-medium hover:bg-white">
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F6F1E7] text-[#111827]">
      <TopNav />
      {children}
      <footer className="mt-20 border-t border-[#D8D2C4] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/images/just-ask-bips-logo.png" alt="" className="size-14 object-contain drop-shadow-[1px_2px_1px_rgba(17,24,39,.16)]" />
            <div>
              <p className="font-heading font-semibold">Just Ask BIPs - Consensus Edition</p>
              <p className="mt-1 text-sm text-[#6B7280]">Consensus history, explained from the source.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-[#6B7280]">
            <Link to="/method" className="hover:text-[#111827]">How We Stay Neutral</Link>
            <span>Independent educational project</span>
            <a href="https://shakespeare.diy" target="_blank" rel="noreferrer" className="hover:text-[#111827]">Vibed with Shakespeare</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-[#D8D2C4] pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#00A7CC]">{eyebrow}</p>
        <h1 className="font-heading text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[#5B6472]">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SearchAskBar({
  initialValue = '',
  compact = false,
  bipNumber,
}: {
  initialValue?: string;
  compact?: boolean;
  bipNumber?: number;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialValue);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim()) navigate(`/ask?q=${encodeURIComponent(query)}${bipNumber ? `&bip=${bipNumber}` : ''}`);
  };
  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border border-[#CBD3DF] bg-white p-2 shadow-[0_10px_40px_rgba(17,24,39,.08)] focus-within:border-[#00A7CC] focus-within:ring-4 focus-within:ring-[#00D1FF]/10',
        compact ? 'max-w-2xl' : 'max-w-3xl',
      )}
    >
      <Search className="ml-2 size-5 shrink-0 text-[#6B7280]" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base outline-none sm:text-lg"
        placeholder="Ask anything — even the basics. Try Taproot, SegWit, CTV…"
        aria-label="Ask a question about BIPs"
      />
      <Button type="submit">Ask <ArrowRight className="hidden sm:block" /></Button>
    </form>
  );
}

const statusStyle: Record<BipStatus, string> = {
  Draft: 'border-amber-200 bg-amber-50 text-amber-800',
  Proposed: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  Complete: 'border-orange-200 bg-orange-50 text-orange-800',
  Final: 'border-blue-200 bg-blue-50 text-blue-700',
  Active: 'border-green-200 bg-green-50 text-green-700',
  Deployed: 'border-green-200 bg-green-50 text-green-700',
  Closed: 'border-slate-200 bg-slate-100 text-slate-700',
  Rejected: 'border-red-200 bg-red-50 text-red-700',
  Withdrawn: 'border-gray-200 bg-gray-100 text-gray-600',
  Replaced: 'border-violet-200 bg-violet-50 text-violet-700',
  Unknown: 'border-gray-200 bg-gray-100 text-gray-600',
};

export function StatusChip({ status }: { status: BipStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold', statusStyle[status])}>
      <span className="mr-1.5 size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const difficultyStyle: Record<DifficultyLevel, string> = {
  Beginner: 'border-[#BCE3C7] bg-[#EFFBF1] text-[#166534]',
  Intermediate: 'border-[#D8D2C4] bg-[#F3EFE5] text-[#57544B]',
  Advanced: 'border-[#8AB9C4] bg-[#EAF8FB] text-[#0E5A6B]',
};

export function DifficultyChip({ level }: { level: DifficultyLevel }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide', difficultyStyle[level])}>
      {level}
    </span>
  );
}

export function SourceChip({ citation, onClick }: { citation: Citation; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-sm border border-[#8AB9C4] bg-[#F7FCFD] px-2.5 py-1.5 font-mono text-xs text-[#164E63] transition hover:border-[#00A7CC] hover:text-[#075985] hover:shadow-[0_0_12px_rgba(0,209,255,.16)]"
    >
      <FileText className="size-3.5" />
      {citation.label} · {citation.section}
    </button>
  );
}

export function BipCard({ bip, askOrigin }: { bip: Bip; askOrigin?: string }) {
  const askSuffix = askOrigin ? `&origin=${encodeURIComponent(askOrigin)}` : '';
  return (
    <article className="archive-surface group relative flex h-full flex-col overflow-hidden rounded-lg border border-[#D8D2C4] p-5 transition hover:-translate-y-0.5 hover:border-[#A69F91] hover:shadow-[4px_4px_0_rgba(17,24,39,.06)] before:absolute before:top-0 before:left-5 before:h-1 before:w-12 before:bg-[#F7931A]">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-sm font-bold text-[#9A4F00]">BIP {bip.number}</span>
        <StatusChip status={bip.status} />
      </div>
      <h3 className="mt-5 text-xl font-semibold leading-snug tracking-tight">{bip.title}</h3>
      {bip.plainSummary && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] font-medium text-[#00838F]">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          In plain terms: {bip.plainSummary}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <DifficultyChip level={bip.difficulty} />
        {bip.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="rounded-md bg-[#F3F5F8] px-2 py-1 text-xs text-[#4B5563]">{tag}</span>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[#EDF0F4] pt-4 text-sm font-semibold">
        <Link to={`/bips/${bip.number}`} className="text-[#111827] hover:underline">Read</Link>
        <Link to={`/ask?bip=${bip.number}${askSuffix}&q=${encodeURIComponent(`Explain BIP ${bip.number} in plain terms.`)}`} className="text-[#00A7CC] hover:underline">
          Ask
        </Link>
        <Link to={`/ask?bip=${bip.number}${askSuffix}&q=${encodeURIComponent(`Compare BIP ${bip.number} to Taproot.`)}`} className="text-[#4B5563] hover:text-[#111827]">
          Compare <ChevronRight className="inline size-4" />
        </Link>
      </div>
    </article>
  );
}

export function TimelineEvent({ item, index }: { item: TimelineItem; index: number }) {
  return (
    <Link
      to={`/bips/${item.bipNumber}`}
      className="archive-surface group relative block rounded-lg border border-[#D8D2C4] p-5 transition hover:border-[#00A7CC] hover:shadow-[0_0_16px_rgba(0,209,255,.09)]"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs font-semibold text-[#6B7280]">{String(index + 1).padStart(2, '0')} · {item.year}</span>
        <StatusChip status={item.status} />
      </div>
      <p className="font-mono text-xs font-bold text-[#9A4F00]">BIP {item.bipNumber}</p>
      <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
      <p className="mt-2 flex items-start gap-1.5 text-sm leading-6 text-[#6B7280]">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#00838F]" />
        {item.plainImpact}
      </p>
      {item.relatedBips.length > 0 && (
        <p className="mt-3 font-mono text-[11px] text-[#8A8478]">
          Related: {item.relatedBips.map((n) => `BIP ${n}`).join(', ')}
        </p>
      )}
      <div className="mt-4 flex items-center text-sm font-semibold text-[#00A7CC]">
        Understand what changed and why <ChevronRight className="size-4 transition group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

export function SentimentMeter({ data }: { data: SentimentData }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" aria-label={`Current mood score ${data.score}`}>
        <div className="bg-[#DC2626]" style={{ width: `${data.against}%` }} />
        <div className="bg-[#9CA3AF]" style={{ width: `${data.neutral}%` }} />
        <div className="bg-[#16A34A]" style={{ width: `${data.for}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 text-xs sm:text-sm">
        <span className="text-[#DC2626]">{sentimentLabel.Against} {data.against}%</span>
        <span className="text-center text-[#6B7280]">{sentimentLabel.Neutral} {data.neutral}%</span>
        <span className="text-right text-[#16A34A]">{sentimentLabel.For} {data.for}%</span>
      </div>
    </div>
  );
}

export function BipMetadataPanel({ bip }: { bip: Bip }) {
  return (
    <aside className="rounded-xl border border-[#D8D2C4] bg-white p-5">
      <h2 className="font-semibold">Source metadata</h2>
      <dl className="mt-5 space-y-4 text-sm">
        {[
          ['Authors', bip.authors.join(', ')],
          ['Created', bip.created],
          ['Era', bip.era],
          ['Layer', bip.layer],
          ['Difficulty', bip.difficulty],
          ['Activation', bip.activated ?? 'Not activated'],
        ].map(([term, value]) => (
          <div key={term} className="grid grid-cols-[90px_1fr] gap-3">
            <dt className="text-[#6B7280]">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export function SourceDrawer({
  citation,
  open,
  onOpenChange,
}: {
  citation?: Citation;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{citation?.label}</DialogTitle>
          <DialogDescription>What the BIP says · {citation?.section}</DialogDescription>
        </DialogHeader>
        <blockquote className="rounded-lg border-l-4 border-[#00A7CC] bg-[#F5FBFD] p-4 leading-7 text-[#374151]">
          “{citation?.excerpt}”
        </blockquote>
        <p className="text-sm text-[#6B7280]">
          Source links are provided for verification. Review the sources before deciding — the plain-language explanation may simplify the normative specification.
        </p>
        <DialogFooter>
          <Button asChild variant="outline">
            <a href={citation?.url} target="_blank" rel="noreferrer">Open primary source <ExternalLink /></a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const coverageStyle: Record<CoverageTier, string> = {
  Strong: 'border-green-200 bg-green-50 text-green-700',
  Partial: 'border-amber-200 bg-amber-50 text-amber-800',
  Weak: 'border-red-200 bg-red-50 text-red-700',
};

export function AskAnswerCard({ answer }: { answer: AskAnswer }) {
  const [citation, setCitation] = useState<Citation>();
  const showCoverageWarning = answer.coverageTier !== 'Strong';
  return (
    <article className="rounded-xl border border-[#D8D2C4] bg-white shadow-sm">
      <div className="border-b border-[#EDF0F4] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#00A7CC]">
            <BookOpen className="size-4" />
            Source-grounded answer
          </span>
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold', coverageStyle[answer.coverageTier])}>
            Source coverage: {answer.coverageTier}
          </span>
        </div>
        <Markdown content={answer.shortAnswer} className="mt-5 text-2xl font-semibold leading-snug" />

        <div className="mt-5 rounded-lg border border-[#BCE3C7] bg-[#F3FBF4] p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#166534]">
            <Sparkles className="size-3.5" /> In plain terms
          </p>
          <Markdown content={answer.inPlainTerms} className="editorial-copy mt-2 text-lg leading-8 text-[#1F3B2C]" />
        </div>

        <div className="mt-4 rounded-lg border border-[#D8D2C4] bg-[#FAF7EF] p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            <ScrollText className="size-3.5" /> What the BIPs say
          </p>
          <Markdown content={answer.whatBipsSay} className="mt-2 text-[15px] leading-7 text-[#374151]" />
        </div>

        {showCoverageWarning && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>This answer is only partially supported by indexed BIP source material. Review the sources before forming a final opinion.</span>
          </div>
        )}
      </div>

      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[1fr_220px]">
        <div>
          <h3 className="text-sm font-semibold">Source citations</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {answer.citations.map((item) => (
              <SourceChip key={item.id} citation={item} onClick={() => setCitation(item)} />
            ))}
          </div>

          {answer.relatedBips.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Related BIPs</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {answer.relatedBips.map((number) => (
                  <Link key={number} to={`/bips/${number}`} className="rounded-md border border-[#D8D2C4] bg-white px-2.5 py-1 font-mono text-xs text-[#111827] hover:border-[#00A7CC]">
                    BIP {number}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {answer.followUps.length > 0 && (
            <div className="mt-5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle className="size-4 text-[#00A7CC]" /> Keep asking</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {answer.followUps.map((question) => (
                  <Link
                    key={question}
                    to={`/ask?q=${encodeURIComponent(question)}`}
                    className="rounded-full border border-[#D8D2C4] bg-[#FFFDF7] px-3 py-1.5 text-xs text-[#4B5563] hover:border-[#00A7CC] hover:text-[#075985]"
                  >
                    {question}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <strong>Worth noting:</strong> {answer.caveat}
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm">
            <span>Coverage score</span>
            <strong>{answer.coverage}%</strong>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E5E7EB]">
            <div className="h-full rounded-full bg-[#00A7CC]" style={{ width: `${answer.coverage}%` }} />
          </div>
          <p className="mt-2 text-xs leading-5 text-[#6B7280]">Estimate of relevant source sections represented in this answer.</p>
        </div>
      </div>
      <SourceDrawer citation={citation} open={Boolean(citation)} onOpenChange={(value) => { if (!value) setCitation(undefined); }} />
    </article>
  );
}

export function BothSides({ bip }: { bip: Bip }) {
  return (
    <section className="rounded-xl border border-[#D8D2C4] bg-white p-6">
      <h2 className="font-heading text-2xl font-semibold">Both sides, without the shouting.</h2>
      <p className="mt-2 text-sm leading-6 text-[#6B7280]">
        Just Ask BIPs does not take a position on whether this proposal is good or bad for Bitcoin. Here is a neutral summary of the strongest arguments on each side, and what still isn’t settled.
      </p>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-[#BCE3C7] bg-[#F3FBF4] p-4">
          <h3 className="text-sm font-semibold text-[#166534]">The case for</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#1F3B2C]">
            {bip.caseFor.map((point) => <li key={point} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#16A34A]" />{point}</li>)}
          </ul>
        </div>
        <div className="rounded-lg border border-[#F5C6C6] bg-[#FDF3F3] p-4">
          <h3 className="text-sm font-semibold text-[#991B1B]">The case against</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#3B1F1F]">
            {bip.caseAgainst.map((point) => <li key={point} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#DC2626]" />{point}</li>)}
          </ul>
        </div>
        <div className="rounded-lg border border-[#D8D2C4] bg-[#FAF7EF] p-4">
          <h3 className="text-sm font-semibold text-[#57544B]">What is still unclear</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#3A382F]">
            {bip.stillUnclear.map((point) => <li key={point} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#9A958A]" />{point}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function NpubLoginButton({ npub, onLogin }: { npub: string; onLogin: (npub: string) => void }) {
  return npub ? (
    <div className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 font-mono text-xs text-green-800">
      <ShieldCheck className="size-4" />
      {npub}
    </div>
  ) : (
    <Button variant="outline" onClick={() => onLogin('npub1justaskbipsdemo7h3k9m2x')}>
      <Zap className="text-[#F7931A]" /> Mock npub login
    </Button>
  );
}

export function VoteModal({
  open,
  onOpenChange,
  choice,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  choice: SentimentChoice;
  onConfirm: () => void;
}) {
  const [paid, setPaid] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) setPaid(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{paid ? 'Signal recorded' : 'Add your signal'}</DialogTitle>
          <DialogDescription>
            {paid
              ? 'Signal recorded. Thanks for adding your voice.'
              : 'Your 10 sats signal helps show where the community stands. It does not decide Bitcoin consensus.'}
          </DialogDescription>
        </DialogHeader>
        {paid ? (
          <div className="grid place-items-center rounded-xl bg-green-50 py-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-green-600 text-white"><Check /></span>
            <p className="mt-4 font-semibold">Thanks for adding your voice.</p>
            <p className="mt-1 text-sm text-[#6B7280]">10 sats · demo invoice</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#D8D2C4] p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium">
                <CircleDollarSign className="text-[#F7931A]" />
                Your signal: {sentimentLabel[choice]}
              </span>
              <strong className="font-mono">10 sats</strong>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#6B7280]">
              This is a simulated payment. No wallet or payment service is contacted.
            </p>
          </div>
        )}
        <DialogFooter>
          {paid ? (
            <Button onClick={() => { onConfirm(); onOpenChange(false); }}>Done</Button>
          ) : (
            <Button className="bg-[#F7931A] text-[#111827] hover:bg-[#E9850A]" onClick={() => setPaid(true)}>
              <Zap /> Pay mock invoice
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#B8C1CE] bg-white p-10 text-center">
      <Search className="mx-auto size-7 text-[#9CA3AF]" />
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#6B7280]">{body}</p>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-red-300 bg-red-50 p-10 text-center">
      <TriangleAlert className="mx-auto size-7 text-red-500" />
      <h3 className="mt-4 font-semibold text-red-800">Something went wrong.</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-red-700">Give it another try.</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
