import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MemoEvidence, { evidenceNameParts } from './MemoEvidence.jsx';

describe('memo evidence name emphasis', () => {
  it('emphasizes only the selected name, including an inserted abbreviation', () => {
    const passage = 'The Social Emotional Learning (SEL) program supports students. Parents participate.';
    const { container } = render(<MemoEvidence passage={passage} label="Social Emotional Learning program" />);
    expect(container.textContent).toBe(passage);
    expect(container.querySelectorAll('strong')).toHaveLength(1);
    expect(container.querySelector('strong').textContent).toBe('Social Emotional Learning (SEL) program');
  });
  it('preserves case and whitespace while matching every complete name', () => {
    const passage = 'A community counselor meets the COMMUNITY\nCOUNSELOR, not counselors.';
    const parts = evidenceNameParts(passage, 'Community counselor');
    expect(parts.map(part => part.text).join('')).toBe(passage);
    expect(parts.filter(part => part.emphasis).map(part => part.text)).toEqual(['community counselor', 'COMMUNITY\nCOUNSELOR']);
  });
  it('does not highlight parts of words or infer absent names', () => {
    expect(evidenceNameParts('Parents spoke to a counselor.', 'Parent').some(part => part.emphasis)).toBe(false);
    expect(evidenceNameParts('Counselors support students.', 'District office').some(part => part.emphasis)).toBe(false);
  });
  it('renders untrusted passage text literally and escapes label metacharacters', () => {
    const passage = '<script>alert(1)</script> discusses A+B [group].';
    const { container } = render(<MemoEvidence passage={passage} label="A+B [group]" />);
    expect(container.textContent).toBe(passage);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('strong').textContent).toBe('A+B [group]');
  });
  it('can match the full name when its displayed label includes an acronym', () => {
    const parts = evidenceNameParts('Centralized School Response Clinicians share a student case.', 'Centralized School Response Clinicians (CSRCs)');
    expect(parts.filter(part => part.emphasis).map(part => part.text)).toEqual(['Centralized School Response Clinicians']);
  });
});
