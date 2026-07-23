import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/utils';

type MarkdownProps = {
  content: string;
  className?: string;
};

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
  },
};

const baseComponents: Components = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="leading-7">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="ml-4 list-disc space-y-2">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="ml-4 list-decimal space-y-2">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="pl-1">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="rounded bg-black/5 px-1.5 py-0.5 text-sm">{children}</code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="overflow-x-auto rounded-lg bg-black/5 p-3 text-sm">{children}</pre>
  ),
  hr: () => (
    <hr className="my-4 border-t border-[#E5E7EB]" />
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-l-2 border-[#00A7CC] pl-4 text-[#374151]">{children}</blockquote>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-2xl font-semibold">{children}</h2>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-xl font-semibold">{children}</h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h4 className="text-lg font-semibold">{children}</h4>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h5 className="text-base font-semibold">{children}</h5>
  ),
  a: ({ children, href, ...rest }: ComponentPropsWithoutRef<'a'>) => (
    <a className="text-[#075985] underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  ),
};

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={baseComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
