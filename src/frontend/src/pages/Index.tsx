import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, MessageCircleQuestion, Search, ShieldCheck, Users } from 'lucide-react';
import { apiClient } from '@/api/apiClient';
import { AppShell, BipCard, ErrorState, SearchAskBar } from '@/components/product';
import { Button } from '@/components/ui/button';

const journeySteps = [
  { title: 'Pick a proposal', body: 'Browse BIPs by status, topic, or era — no prior technical knowledge required.' },
  { title: 'Read it in plain terms', body: 'Every proposal starts with a plain-language explanation, before any jargon.' },
  { title: 'Ask anything', body: 'No question is too basic. Every answer is grounded in BIP source material.' },
  { title: 'See where people stand', body: 'View community signal on a proposal — never mistaken for Bitcoin governance.' },
];

const Index = () => {
  useSeoMeta({
    title: 'Just Ask BIPs - Consensus Edition',
    description: 'Understand Bitcoin consensus proposals from the source. Ask questions, see both sides, and decide for yourself.',
  });

  const bips = useQuery({ queryKey: ['bips', 'featured'], queryFn: () => apiClient.listBips({}) });
  const featured = bips.data?.filter((bip) => [141, 341, 119].includes(bip.number));

  return (
    <AppShell>
      <main>
        <section className="relative isolate min-h-[720px] overflow-hidden border-b border-[#B9B0A2] sm:min-h-[760px] lg:min-h-[min(790px,calc(100svh-4rem))]">
          <img
            src="/images/bip-archive-hero.png"
            alt="An illustrated archive lined with volumes for Bitcoin Improvement Proposals"
            className="absolute inset-0 -z-20 size-full object-cover object-[66%_center] sm:object-[62%_center] lg:object-center"
            fetchPriority="high"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(255,253,247,.98)_0%,rgba(255,253,247,.94)_34%,rgba(255,253,247,.55)_54%,rgba(255,253,247,.06)_76%)] sm:bg-[linear-gradient(90deg,rgba(255,253,247,.98)_0%,rgba(255,253,247,.92)_36%,rgba(255,253,247,.32)_62%,rgba(255,253,247,.02)_80%)]" />
          <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#FFFDF7]/95 to-transparent lg:h-32" />

          <div className="mx-auto flex min-h-[720px] max-w-7xl flex-col px-4 py-10 sm:min-h-[760px] sm:px-6 sm:py-14 lg:min-h-[min(790px,calc(100svh-4rem))] lg:px-8 lg:py-16">
            <div className="max-w-[44rem]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#AFA89D]/60 bg-[#FFFDF7]/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#374151] shadow-sm backdrop-blur-sm sm:text-xs">
                <ShieldCheck className="size-3.5 text-[#00A7CC]" />
                No hype. No sides.
              </div>
              <h1 className="mt-6 max-w-[43rem] text-[clamp(2.6rem,6.6vw,4.6rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-[#111827]">
                Understand Bitcoin consensus proposals <span className="text-[#9A4F00]">from the source.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[#374151] sm:text-xl">
                Ask questions, see both sides, and decide for yourself — no hype, no sides, no getting flamed for basic questions.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg" className="shadow-sm">
                  <Link to="/ask">Ask the BIPs <ArrowRight /></Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-[#AAB1BB] bg-[#FFFDF7]/80 backdrop-blur-sm hover:bg-white">
                  <Link to="/explore">Explore proposals</Link>
                </Button>
              </div>
            </div>

            <div className="mt-auto w-full pt-12 lg:max-w-3xl">
              <p className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#374151] sm:text-xs">
                Search the archive or ask a question
              </p>
              <SearchAskBar />
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#4B5563]">
                <span>15 curated proposals</span>
                <span className="hidden sm:inline">Primary citations included</span>
                <span className="hidden sm:inline">Uncertainty made visible</span>
              </div>
            </div>
          </div>
        </section>

        <section className="relative isolate min-h-[500px] overflow-hidden border-b border-[#292E32]">
          <img
            src="/images/why-consensus-crossroads.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-20 size-full object-cover object-center"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(9,14,18,.94)_0%,rgba(9,14,18,.82)_42%,rgba(9,14,18,.35)_72%,rgba(9,14,18,.56)_100%)] sm:bg-[linear-gradient(90deg,rgba(9,14,18,.92)_0%,rgba(9,14,18,.76)_44%,rgba(9,14,18,.22)_72%,rgba(9,14,18,.48)_100%)]" />
          <div className="mx-auto flex min-h-[500px] max-w-7xl items-center px-4 py-16 sm:px-6 lg:px-8">
            <div className="max-w-xl rounded-xl border border-white/20 bg-[#111820]/75 p-6 shadow-xl backdrop-blur-[2px] sm:p-8">
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#FFB75A]">Why this exists</p>
              <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-[#FFF9ED] sm:text-4xl">
                When Bitcoin debates explode, the loudest voices usually win.
              </h2>
              <p className="mt-5 text-lg leading-8 text-[#F1E8D8]">
                Just Ask BIPs gives you the source material, plain-language explanations, and a place to ask basic questions without getting talked down to. Understand it, then decide for yourself.
              </p>
            </div>
          </div>
        </section>

        <section className="relative isolate overflow-hidden border-b border-[#B9B0A2]">
          <img
            src="/images/journey-steps.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-20 size-full object-cover object-[62%_center] sm:object-center"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(246,241,231,.88)_0%,rgba(246,241,231,.62)_42%,rgba(246,241,231,.34)_100%)]" />
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#9A4F00]">The journey</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">From curious to informed, one step at a time</h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {journeySteps.map((step, index) => (
                <div key={step.title} className="archive-surface relative rounded-lg border border-[#D8D2C4] p-5">
                  <span className="font-mono text-xs font-bold text-[#00A7CC]">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6B7280]">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#00A7CC]">Start with the record</p>
              <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Featured proposals</h2>
            </div>
            <Button asChild variant="ghost" className="hidden sm:flex">
              <Link to="/explore">Browse all <ArrowRight /></Link>
            </Button>
          </div>
          {bips.isError ? (
            <div className="mt-8">
              <ErrorState onRetry={() => bips.refetch()} />
            </div>
          ) : (
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {featured?.map((bip) => <BipCard key={bip.number} bip={bip} askOrigin="explore" />)}
            </div>
          )}
        </section>

        <section className="mx-auto grid max-w-7xl gap-5 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            [Search, 'Ask with evidence', 'Every answer exposes the BIP sections used and makes uncertainty visible.'],
            [BookOpen, 'Compare proposals', 'Browse status, topic, and difficulty in one calm index.'],
            [Users, 'See where people stand', 'Community signal, clearly separated from Bitcoin consensus itself.'],
          ].map(([Icon, title, body]) => {
            const FeatureIcon = Icon as typeof Search;
            return (
              <div key={String(title)} className="rounded-xl border border-[#D8D2C4] bg-white p-6">
                <FeatureIcon className="size-6 text-[#00A7CC]" />
                <h3 className="mt-5 text-xl font-semibold">{String(title)}</h3>
                <p className="mt-3 text-sm leading-6 text-[#6B7280]">{String(body)}</p>
              </div>
            );
          })}
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start gap-4 rounded-xl border border-[#D8D2C4] bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MessageCircleQuestion className="mt-1 size-6 shrink-0 text-[#F7931A]" />
              <div>
                <p className="font-semibold">“Is this good for Bitcoin?”</p>
                <p className="mt-1 text-sm leading-6 text-[#6B7280]">It’s the question everyone asks. We won’t answer it for you — but we’ll help you understand it well enough to answer it yourself.</p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/ask">Ask anything</Link>
            </Button>
          </div>
        </section>
      </main>
    </AppShell>
  );
};

export default Index;
