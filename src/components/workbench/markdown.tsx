'use client';

import type { ReactNode } from 'react';

import { resolveDeltaRef, shortId } from './model';

/**
 * A deliberately tiny markdown subset for model output: paragraphs, headings
 * (rendered as strong lines), bullet and numbered lists, fenced code, bold,
 * italics, inline code, http(s) links and `[deltaId]` references. Everything
 * becomes React text nodes, so raw HTML in the input is shown, never parsed.
 */

export interface MarkdownProps {
  readonly text: string | null | undefined;
  readonly knownIds?: Iterable<string>;
  readonly onDeltaRef?: (id: string) => void;
  readonly className?: string;
}

type Block =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'h'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: string[] }
  | { readonly kind: 'code'; readonly text: string };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara();
      flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', text: heading[1] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      const items: string[] = (list as { items: string[] }).items;
      items[items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\[[0-9a-fA-F]{6,16}(?:\s*,\s*[0-9a-fA-F]{6,16})*\])|(\*[^*\s][^*\n]*\*)|(\b_[^_\n]+_\b)/g;

function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

interface InlineContext {
  readonly ids: readonly string[];
  readonly onDeltaRef?: (id: string) => void;
}

export function renderInline(text: string, ctx: InlineContext, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE.lastIndex = 0;
  const matches = [...text.matchAll(INLINE)];
  for (const m of matches) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${n++}`;
    const [whole, code, bold, link, ref, star, under] = m;
    if (code) {
      out.push(
        <code key={key} className="wb-md__code">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      out.push(<strong key={key}>{renderInline(bold.slice(2, -2), ctx, key)}</strong>);
    } else if (link) {
      const split = link.indexOf('](');
      const label = link.slice(1, split);
      const href = safeHref(link.slice(split + 2, -1));
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="wb-link">
            {renderInline(label, ctx, key)}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else if (ref) {
      ref
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .forEach((raw, j) => {
          const id = resolveDeltaRef(raw, ctx.ids);
          const refKey = `${key}-${j}`;
          if (j > 0) out.push(' ');
          out.push(
            id && ctx.onDeltaRef ? (
              <button
                key={refKey}
                type="button"
                className="wb-ref"
                onClick={() => ctx.onDeltaRef?.(id)}
                title={`Show delta ${id}`}
              >
                {shortId(id)}
              </button>
            ) : (
              <span key={refKey} className="wb-ref wb-ref--plain">
                [{raw}]
              </span>
            ),
          );
        });
    } else if (star || under) {
      const inner = (star ?? under)!.slice(1, -1);
      out.push(<em key={key}>{renderInline(inner, ctx, key)}</em>);
    } else {
      out.push(whole);
    }
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, knownIds, onDeltaRef, className }: MarkdownProps) {
  const source = typeof text === 'string' ? text : '';
  if (source.trim() === '') return null;
  const ctx: InlineContext = { ids: knownIds ? [...knownIds] : [], onDeltaRef };
  const blocks = parseBlocks(source);
  return (
    <div className={['wb-md', className].filter(Boolean).join(' ')}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case 'p':
            return <p key={key}>{renderInline(block.text, ctx, key)}</p>;
          case 'h':
            return (
              <p key={key} className="wb-md__h">
                <strong>{renderInline(block.text, ctx, key)}</strong>
              </p>
            );
          case 'code':
            return (
              <pre key={key} className="wb-md__pre">
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={key}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, ctx, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, ctx, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}
