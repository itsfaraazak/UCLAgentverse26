// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ID, MESSAGE_MARKDOWN, SNAPSHOT } from './__fixtures__/snapshot';
import { Markdown, parseBlocks } from './markdown';

const IDS = SNAPSHOT.deltas.map((d) => d.id);

describe('Markdown', () => {
  it('shows raw HTML and script as text, never as elements', () => {
    const { container } = render(
      <Markdown text={'<script>window.pwned = 1</script> <img src=x onerror="alert(1)"> **<b>bold</b>**'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>window.pwned = 1</script>');
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector('strong')?.textContent).toBe('<b>bold</b>');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('turns [deltaId] and unambiguous prefixes into clickable refs', () => {
    const onDeltaRef = vi.fn();
    render(<Markdown text={MESSAGE_MARKDOWN} knownIds={IDS} onDeltaRef={onDeltaRef} />);

    const refs = screen.getAllByRole('button');
    expect(refs.map((b) => b.textContent)).toEqual([ID.interp.slice(0, 8), ID.evidence.slice(0, 8), ID.reference.slice(0, 8)]);

    fireEvent.click(refs[1]);
    expect(onDeltaRef).toHaveBeenCalledWith(ID.evidence);
    fireEvent.click(screen.getByTitle(`Show delta ${ID.reference}`));
    expect(onDeltaRef).toHaveBeenLastCalledWith(ID.reference);
  });

  it('leaves unknown or ambiguous refs as plain text', () => {
    const onDeltaRef = vi.fn();
    const { container } = render(
      <Markdown text="See [abcdef12] and [d1000000]." knownIds={['d1000000000000d1', 'd1000000ffff0000']} onDeltaRef={onDeltaRef} />,
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('See [abcdef12] and [d1000000].');
  });

  it('renders refs as plain text when there is no click handler', () => {
    const { container } = render(<Markdown text={`[${ID.interp}]`} knownIds={IDS} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe(`[${ID.interp}]`);
  });

  it('renders bold, italics, inline code, headings, bullet and numbered lists', () => {
    const { container } = render(
      <Markdown text={'## Verdict\n**VUS** with *care* and `BS1`\n\n- one\n- two\n  continued\n\n1. first\n2. second'} />,
    );
    expect(container.querySelector('.wb-md__h strong')?.textContent).toBe('Verdict');
    expect(container.querySelector('p:not(.wb-md__h) strong')?.textContent).toBe('VUS');
    expect(container.querySelector('em')?.textContent).toBe('care');
    expect(container.querySelector('code')?.textContent).toBe('BS1');
    expect([...container.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['one', 'two continued']);
    expect([...container.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['first', 'second']);
  });

  it('links only http(s) and mailto URLs, opening safely in a new tab', () => {
    const { container } = render(
      <Markdown text={'[ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/) [bad](javascript:alert(1)) [data](data:text/html,x)'} />,
    );
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://www.ncbi.nlm.nih.gov/clinvar/');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('data:text');
    expect(container.textContent).toContain('bad');
  });

  it('keeps fenced code verbatim and unparsed', () => {
    const { container } = render(<Markdown text={'```\n**not bold** <i>x</i>\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toBe('**not bold** <i>x</i>');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('renders nothing for empty, null or undefined text', () => {
    for (const text of ['', '   ', null, undefined]) {
      const { container, unmount } = render(<Markdown text={text} />);
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('parseBlocks splits paragraphs, lists and code', () => {
    expect(parseBlocks('a\nb\n\n- x\n1. y\n```\nz\n```')).toEqual([
      { kind: 'p', text: 'a b' },
      { kind: 'ul', items: ['x'] },
      { kind: 'ol', items: ['y'] },
      { kind: 'code', text: 'z' },
    ]);
  });
});
