import { describe, expect, it } from 'vitest';
import { analyzeMemoSource, bibliographyOnlyEvidence, bibliographyOnlyLabel, memoRepairPassages, memoStructure } from './memo-source.js';
import { CITATION_MEMO, CITATION_COMPARISON_CASES } from '../tests/fixtures/memo-citation-cases.js';

describe('memo source boundaries', () => {
  it('keeps the complete source and citation-bearing narrative while identifying a reference list', () => {
    const source = analyzeMemoSource(CITATION_MEMO);
    expect(source.text).toBe(CITATION_MEMO);
    expect(source.narrativeText).toContain('(Smith, 2025, p. 12)');
    expect(source.bibliographyRanges).toHaveLength(1);
    const { start, end } = source.bibliographyRanges[0];
    expect(CITATION_MEMO.slice(start, end)).toContain('References\nSmith, A.');
    expect(source.narrativeText).toHaveLength(CITATION_MEMO.length);
    expect(memoStructure(source).inlineCitationsPresent).toBe(true);
    for (const label of CITATION_COMPARISON_CASES.find(fixture => fixture.id === 'pasted-inline-references').bibliographyOnlyLabels) expect(bibliographyOnlyLabel(label, source), label).toBe(true);
    expect(bibliographyOnlyLabel('Rosa', source)).toBe(false);
    expect(bibliographyOnlyLabel('Rosa', analyzeMemoSource('Rosa (2008) attends the school.'))).toBe(false);
    expect(bibliographyOnlyEvidence('Smith, A. (2025). Community schooling. Example Press.', source)).toBe(true);
    expect(bibliographyOnlyEvidence('Rosa meets the teacher at the school (Smith, 2025, p. 12).', source)).toBe(false);
  });

  it('recognizes an unheaded author-year bibliography without treating an ordinary year as a citation', () => {
    const source = analyzeMemoSource('In 2025 Rosa meets Teacher Smith at school.\n\nSmith, A. (2025). Community schooling. Example Press.');
    expect(source.bibliographyRanges).toHaveLength(1);
    expect(bibliographyOnlyLabel('Smith', source)).toBe(false);
    expect(bibliographyOnlyLabel('Example Press', source)).toBe(true);
    expect(analyzeMemoSource('References help students find a source. Rosa was born in 2000.').bibliographyRanges).toEqual([]);
  });

  it('keeps separately described actors and resumes narrative after a reference section', () => {
    const actor = analyzeMemoSource(CITATION_COMPARISON_CASES.find(fixture => fixture.id === 'narrative-author-and-citation').text);
    expect(bibliographyOnlyLabel('Smith', actor)).toBe(false);
    const appendix = analyzeMemoSource(CITATION_COMPARISON_CASES.find(fixture => fixture.id === 'late-narrative-after-references').text);
    expect(appendix.narrativeText).toContain('the navigator helps Rosa');
    expect(appendix.bibliographyText).not.toContain('the navigator helps Rosa');
  });

  it('distinguishes narrative attribution from an author who participates in the case', () => {
    const source = analyzeMemoSource('Smith (2025) reports a pattern of support. Rosa visits school.');
    expect(bibliographyOnlyLabel('Smith', source)).toBe(true);
    expect(bibliographyOnlyLabel('Rosa', source)).toBe(false);
  });

  it('selects bounded exact narrative passages across a long memo for grounding repair', () => {
    const text = `Opening observations.\n\n${'General context. '.repeat(500)}\n\nRosa meets Teacher Smith at the clinic.\n\nReferences\nLee, B. (2024). A book.`;
    const source = analyzeMemoSource(text);
    const passages = memoRepairPassages(source, { nodes: [{ label: 'Teacher Smith' }] });
    expect(passages.length).toBeLessThanOrEqual(6);
    expect(passages.some(passage => passage.text.includes('Rosa meets Teacher Smith'))).toBe(true);
    for (const passage of passages) {
      expect(text.slice(passage.start, passage.end)).toBe(passage.text);
      expect(passage.text.length).toBeLessThanOrEqual(480);
      expect(passage.text).not.toContain('Lee, B.');
    }
  });

  it('bounds multibyte repair passages by transport bytes as well as characters', () => {
    const text = '家族と学校の交流。'.repeat(1000);
    const passages = memoRepairPassages(analyzeMemoSource(text));
    expect(passages.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(passages)).byteLength).toBeLessThan(5 * 1024 + 10);
    for (const passage of passages) expect(text.slice(passage.start, passage.end)).toBe(passage.text);
  });


  it('retains a setting described in parentheses with its founding year', () => {
    const text = 'At the clinic (Harlem Health, founded in 2001), Rosa meets the nurse.';
    const source = analyzeMemoSource(text);
    expect(source.narrativeWithoutCitations).toBe(text);
    expect(bibliographyOnlyLabel('Harlem Health', source)).toBe(false);
    expect(source.citationText).toBe('');
  });

  it('resumes narrative at a titled appendix and tolerates malformed rejected node records', () => {
    const text = 'Rosa meets the teacher.\n\nReferences\nSmith, A. (2025). Community schooling.\n\nAppendix A: Field Notes\nRosa visits the School library with her family.';
    const source = analyzeMemoSource(text);
    expect(bibliographyOnlyLabel('School library', source)).toBe(false);
    expect(source.narrativeText).toContain('Rosa visits the School library');
    expect(memoRepairPassages(source, { nodes: [null, 17, {}] }).some(passage => passage.text.includes('School library'))).toBe(true);
  });

  it.each(['Works Cited', 'Work Cited', 'References', 'Bibliography', '## Works Cited', '**Works Cited**'])('recognizes an MLA list headed %s while preserving inline citations', heading => {
    const narrative = 'Rosa meets the teacher (Smith, 2025, p. 12).';
    const entry = 'Smith, Anna. Community Schooling. Example Press, 2025.';
    const text = narrative + '\n\n' + heading + '\n' + entry;
    const source = analyzeMemoSource(text);
    expect(source.text).toBe(text);
    expect(source.narrativeText).toHaveLength(text.length);
    expect(source.narrativeText).toContain(narrative);
    expect(source.narrativeText).not.toContain(entry);
    expect(source.bibliographyText).toContain(heading);
    expect(source.bibliographyText).toContain(entry);
  });

  it.each(['Appendix A. Interview transcript', 'Appendix A Interview transcript', 'Appendix A: Field Notes', '2. Appendix B — Interviews', 'Interview transcript'])('resumes actual narrative at %s after references', heading => {
    const later = 'Rosa visits the library with her family.';
    const source = analyzeMemoSource('Rosa meets the teacher.\n\nReferences\nSmith, A. (2025). Community schooling. Example Press.\n\n' + heading + '\n' + later);
    expect(source.narrativeText).toContain(heading);
    expect(source.narrativeText).toContain(later);
    expect(source.bibliographyText).not.toContain(later);
  });

  it('retains a narrative References section and ordinary uses of reference words', () => {
    for (const text of [
      'References\nThe teacher references a report (2025) while helping Rosa at school.',
      'The teacher references Smith (2025) while helping Rosa. The family keeps a bibliography of local resources.',
      'Rosa meets the teacher.\n\nSmith, A. (2025) accompanies Rosa to the clinic and speaks with the nurse.',
      'Harlem Health (2001) helps Rosa find a local clinic.',
    ]) {
      const source = analyzeMemoSource(text);
      expect(source.narrativeText).toBe(text);
      expect(source.bibliographyRanges).toEqual([]);
    }
  });

  it.each(['References\n', ''])('recognizes wrapped PDF reference paragraphs with heading %j', heading => {
    const narrative = 'Rosa meets the teacher (Smith & Lee, 2025).';
    const reference = 'Smith, A., & Lee, B.\n(2025). Community schooling and\nfamily support. Example Press.\nhttps://doi.org/10.1234/example';
    const later = 'Rosa visits the School library with her family.';
    const source = analyzeMemoSource(narrative + '\n\n' + heading + reference + '\n\n' + later);
    expect(source.narrativeText).toContain(narrative);
    expect(source.narrativeText).toContain(later);
    expect(source.narrativeText).not.toContain('family support. Example Press.');
    expect(source.bibliographyText).toContain(reference);
  });

  it('joins an explicit author-date continuation across a PDF page break', () => {
    const reference = 'Smith, A., & Lee, B.\n\n(2025). Community schooling.\nExample Press.';
    const source = analyzeMemoSource('Rosa meets the teacher.\n\nReferences\n' + reference + '\n\nAppendix\nRosa visits the library.');
    expect(source.bibliographyText).toContain(reference);
    expect(source.narrativeText).toContain('Rosa visits the library.');
  });

  it('bounds a long wrapped Works Cited list before later narrative without a heading', () => {
    const references = Array.from({ length: 90 }, (_, index) => 'Smith, Anna. Community Schooling ' + (index + 1) + '.\nExample Press, 2025.').join('\n\n');
    const narrative = 'Rosa meets the teacher (Smith, 2025).';
    const later = 'The parent visits the clinic and asks the nurse about the school.';
    const text = narrative + '\n\nWorks Cited\n' + references + '\n\n' + later;
    const source = analyzeMemoSource(text);
    expect(source.text).toBe(text);
    expect(source.bibliographyText).toContain('Community Schooling 90');
    expect(source.bibliographyText).not.toContain(later);
    expect(source.narrativeText).toContain(narrative);
    expect(source.narrativeText).toContain(later);
  });
  it.each([
    'Smith, Anna. Teacher at the school, 2025.',
    'Smith, A. (2025). The teacher helps Rosa complete a form.',
    'References\nSmith, Anna. Teacher at the school, 2025.',
    'References\nSmith, A. (2025). The teacher helps Rosa complete a form.',
    'References\nSmith, A. (2025). The teacher helps Rosa write in her journal.',
  ])('retains an ambiguous actor note formatted like a citation: %s', note => {
    const text = 'Rosa meets the teacher at school.\n\n' + note;
    expect(analyzeMemoSource(text).narrativeText).toBe(text);
    expect(analyzeMemoSource(text).bibliographyRanges).toEqual([]);
  });

  it.each([
    'The principal and family discussed attendance on Tuesday.',
    'On Tuesday, the principal and family discussed attendance.',
    'Rosa and the principal agreed to meet at school.',
  ])('retains narrative following a reference without a blank line: %s', later => {
    const reference = 'Smith, A. (2025). Community schooling. Example Press.';
    const source = analyzeMemoSource('Rosa visits the school.\n\nReferences\n' + reference + '\n' + later);
    expect(source.narrativeText).toContain(later);
    expect(source.bibliographyText).toContain(reference);
    expect(source.bibliographyText).not.toContain(later);
  });

  it('recognizes a headed MLA entry whose publisher has no generic publication keyword', () => {
    const reference = 'Smith, Anna. Community Schooling. Routledge, 2025.';
    const source = analyzeMemoSource('Rosa visits the school.\n\nWorks Cited\n' + reference);
    expect(source.bibliographyText).toContain(reference);
  });

  it.each(['n.d.-a', 'n.d.-b'])('recognizes an undated reference suffix %s and retains its inline citation', date => {
    const narrative = `Rosa meets the teacher (Example School Office, ${date}).`;
    const reference = `Example School Office. (${date}). School support directory.\nhttps://example.test/directory`;
    const source = analyzeMemoSource(`${narrative}\n\nReferences\n${reference}`);
    expect(source.narrativeText).toContain(narrative);
    expect(source.citationText).toContain(`(Example School Office, ${date})`);
    expect(source.bibliographyText).toContain(reference);
  });

  it.each(['', 'References:\n'])('recognizes wrapped web-title references with punctuation and heading %j', heading => {
    const narrative = 'Rosa visits the School library with her family.';
    const references = 'Family Support Services (FSS) - Community Resource Office.\n(2024, February 12). Community Resource Office.\nhttps://example.test/services\nDistrict access: A family guide. (n.d.-a). Resource Center.\nhttps://example.test/guide';
    const source = analyzeMemoSource(`${narrative}\n\n${heading}${references}`);
    expect(source.narrativeText).toContain(narrative);
    expect(source.bibliographyText).toContain(references);
  });

  it('recognizes references on a continued PDF page after its standalone page counter', () => {
    const narrative = 'Rosa visits the clinic (Example School Office, 2025b).';
    const first = 'Example School Office. (2025a). Support directory.\nhttps://example.test/directory';
    const continued = '6\nExample School Office. (2025b, August 12). Family contacts.\nhttps://example.test/contacts';
    const source = analyzeMemoSource(`${narrative}\n\nReferences\n${first}\n\n${continued}`);
    expect(source.narrativeText).toContain(narrative);
    expect(source.bibliographyText).toContain(first);
    expect(source.bibliographyText).toContain(continued);
    expect(source.bibliographyRanges).toHaveLength(1);
  });

  it('retains later assignment text and its example when omitting a PDF reference page', () => {
    const narrative = 'Rosa visits the clinic with her family.';
    const reference = 'Clinic access - Community Office. (2025). Community Office.\nhttps://example.test/access';
    const assignment = 'Assignment 1: Map the local settings\nChoose an issue to investigate.\nExample: After-school access for students in another neighborhood.\nIdentify who participates in each setting.';
    const text = `${narrative}\n\nReferences:\n${reference}\n\n${assignment}`;
    const source = analyzeMemoSource(text);
    expect(source.text).toBe(text);
    expect(source.narrativeText).toContain(narrative);
    expect(source.narrativeText).toContain(assignment);
    expect(source.bibliographyText).toContain(reference);
    expect(source.bibliographyText).not.toContain(assignment);
  });

  it.each([
    'The nurse helped Rosa. (2025). Visit notes at https://example.test/notes.',
    'School Support (SS) - Family Office. (2025). The nurse helps Rosa complete a form. https://example.test/notes.',
    'The nurse helped Rosa. (n.d.-a). Visit notes at https://example.test/notes.',
    '6\nRosa visits the school and reads the guide at https://example.test/guide.',
    'Family Support (FS) - Visit notes. (2025). Rosa supports children at the library. https://example.test/notes.',
    'Parents and school staff - field observation. (2025). A parent shares attendance updates at the school. https://example.test/notes.',
    'The teacher reads the family form. (2025). Visit notes at https://example.test/notes.',
    'Clinic visit. (2025). Rosa calls the nurse. https://example.test/notes',
    'Family meeting. (2025). The parent completes a form. https://example.test/notes',
    'Community support - Resource Office. (2025). Resource Office. https://example.test/guide A parent shares attendance updates at the school.',
  ])('retains uncertain narrative with a URL and citation-like punctuation: %s', note => {
    for (const heading of ['', 'References\n']) {
      const source = analyzeMemoSource(heading + note);
      expect(source.narrativeText).toBe(heading + note);
      expect(source.bibliographyRanges).toEqual([]);
    }
  });

  it('ends a web-title reference at its URL and retains a later actor sentence without a blank line', () => {
    const reference = 'Community support - Resource Office. (2025). Resource Office. https://example.test/guide';
    const narrative = 'A parent shares attendance updates at the school.';
    const laterReference = 'Example School Office. (2025). Guide. https://example.test/guide2';
    const source = analyzeMemoSource(`${reference}\n${narrative}\n${laterReference}`);
    expect(source.bibliographyText).toContain(reference);
    expect(source.narrativeText).toContain(narrative);
    expect(source.bibliographyText).not.toContain(narrative);
    expect(source.text).toContain(laterReference);
  });
});
