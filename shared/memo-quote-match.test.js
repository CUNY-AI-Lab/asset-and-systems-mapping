import { describe, expect, it } from 'vitest';
import { canonicalQuoteText, excerptQuotesMemo } from './memo-quote-match.js';

const memo = 'Rosa’s husband works nights for the transit authority — so she “can’t leave the house” after six.\nHer children attend a community college.';

describe('excerptQuotesMemo', () => {
  it('accepts quotes that differ from a Word memo only in typography or case', () => {
    for (const excerpt of [
      "Rosa's husband works nights",
      'she "can\'t leave the house"',
      'transit authority - so she',
      'transit authority—so she',
      'rosa’s husband',
      'Her children attend a community college.',
      '“Rosa’s husband works nights”',
    ]) expect(excerptQuotesMemo(memo, excerpt), excerpt).toBe(true);
  });

  it('accepts elided quotations whose fragments occur in order', () => {
    expect(excerptQuotesMemo(memo, 'Rosa’s husband … after six')).toBe(true);
    expect(excerptQuotesMemo(memo, "Rosa's husband ... can't leave the house")).toBe(true);
    expect(excerptQuotesMemo(memo, 'works nights [...] community college')).toBe(true);
  });

  it('still rejects paraphrase, invented passages, reordered fragments and trivial fragments', () => {
    for (const excerpt of [
      'Rosa’s husband works days',
      'she cannot leave the house',
      'after six ... Rosa’s husband',
      'Field Notes: plan to interview the transit union',
      'the ... six',
      '...',
      '',
    ]) expect(excerptQuotesMemo(memo, excerpt), excerpt).toBe(false);
  });

  it('canonicalizes both sides the same way', () => {
    expect(canonicalQuoteText('A—B “C” D’s…')).toBe(canonicalQuoteText("a - b \"c\" d's..."));
  });
});
