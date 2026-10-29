import { describe, expect, it } from 'vitest';
import { canonicalQuoteText, classifyExcerptMatch, excerptQuotesMemo } from './memo-quote-match.js';

const memo = 'Rosa’s husband works nights for the transit authority — so she “can’t leave the house” after six.\nHer children attend a community college.';

describe('classifyExcerptMatch', () => {
  it('grades a verbatim quotation as exact, whitespace and NFC aside', () => {
    expect(classifyExcerptMatch(memo, 'Rosa’s husband works nights')).toBe('exact');
    expect(classifyExcerptMatch(memo, 'Her children attend a   community college.')).toBe('exact');
    expect(classifyExcerptMatch(memo, 'transit authority — so she')).toBe('exact');
  });

  it('grades quotes that differ from a Word memo only in typography or case as normalized', () => {
    for (const excerpt of [
      "Rosa's husband works nights",
      'she "can\'t leave the house"',
      'transit authority - so she',
      'transit authority—so she',
      'rosa’s husband',
      '“Rosa’s husband works nights”',
    ]) expect(classifyExcerptMatch(memo, excerpt), excerpt).toBe('normalized');
  });

  it('grades shortened quotations whose fragments occur in order as elided', () => {
    expect(classifyExcerptMatch(memo, 'Rosa’s husband … after six')).toBe('elided');
    expect(classifyExcerptMatch(memo, "Rosa's husband ... can't leave the house")).toBe('elided');
    expect(classifyExcerptMatch(memo, 'works nights [...] community college')).toBe('elided');
  });

  it('distinguishes literal memo ellipses from leading and trailing omissions', () => {
    expect(classifyExcerptMatch('Rosa’s husband pauses … then speaks.', "Rosa's husband pauses ... then speaks.")).toBe('normalized');
    expect(classifyExcerptMatch(memo, "Rosa's husband works nights...")).toBe('elided');
    expect(classifyExcerptMatch(memo, '...community college.')).toBe('elided');
    expect(classifyExcerptMatch(memo, '[...] works nights [...]')).toBe('elided');
    expect(classifyExcerptMatch(memo, '...invented passage...')).toBeNull();
    expect(classifyExcerptMatch(memo, '...the...')).toBeNull();
  });

  it('rejects paraphrase, invented passages, reordered fragments and trivial fragments', () => {
    for (const excerpt of [
      'Rosa’s husband works days',
      'she cannot leave the house',
      'after six ... Rosa’s husband',
      'Field Notes: plan to interview the transit union',
      'the ... six',
      '...',
      '',
    ]) {
      expect(classifyExcerptMatch(memo, excerpt), excerpt).toBeNull();
      expect(excerptQuotesMemo(memo, excerpt), excerpt).toBe(false);
    }
  });

  it('canonicalizes both sides the same way', () => {
    expect(canonicalQuoteText('A—B “C” D’s…')).toBe(canonicalQuoteText("a - b \"c\" d's..."));
  });

  it('preserves dash and quotation matching across repeated spaces and line breaks', () => {
    expect(canonicalQuoteText('A \n\t—\t\n B--C')).toBe('a - b - - c');
    expect(classifyExcerptMatch('A \n\t—\t\n B--C', 'a-b - - c')).toBe('normalized');
  });

  it('handles a large omitted bibliography without repeatedly scanning its whitespace', () => {
    const source = 'Rosa’s teacher' + ' '.repeat(250_000) + '\nAppendix: Rosa—school.';
    const started = performance.now();
    expect(classifyExcerptMatch(source, "rosa's teacher appendix: rosa-school.")).toBe('normalized');
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
