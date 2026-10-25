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
});
