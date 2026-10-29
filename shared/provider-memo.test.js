import { describe, expect, it } from 'vitest';
import { prepareProviderMemo } from './provider-memo.js';
import { BIBLIOGRAPHY_COMPARISON_CASES } from '../tests/fixtures/bibliography-guidance-cases.js';
describe('provider memo reading copy', () => {
  it('keeps the same narrative before and after a large Works Cited section', () => {
    const [plain, heavy] = BIBLIOGRAPHY_COMPARISON_CASES;
    const original = heavy.text;
    const prepared = prepareProviderMemo(original);
    expect(prepared.sourceText.replace(/\s+/g, ' ').trim()).toBe(prepareProviderMemo(plain.text).sourceText.replace(/\s+/g, ' ').trim());
    expect(prepared.sourceText).toContain('(Smith, 2025, p. 12)');
    expect(prepared.sourceText).toContain('Rosa brings the referral form');
    expect(prepared.sourceText).not.toContain('Example Press');
    expect(prepared.source.text).toBe(original);
    expect(new TextEncoder().encode(original).byteLength).toBeGreaterThan(131072);
    expect(new TextEncoder().encode(prepared.sourceText).byteLength).toBeLessThan(1000);
    expect(prepared.memoContext.structure).toMatchObject({ bibliographySectionsOmitted: 1, originalCharacterCount: original.length });
    expect(prepared.memoContext.structure.omissionNotice).toContain('complete original memo remains saved unchanged');
  });
  it('keeps unfamiliar content and ordinary year parentheses available', () => {
    const text = 'Rosa visits the clinic (Harlem Health, founded in 2001).\nReferences\nThe teacher references a report (2025) while helping Rosa.';
    expect(prepareProviderMemo(text).sourceText).toBe(text);
  });
});
