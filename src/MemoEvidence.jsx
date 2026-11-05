import React from 'react';

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Match the displayed name without changing the source passage. A memo may
// insert an acronym into the full name, e.g. Learning (SEL) program.
export function evidenceNameParts(passage, label) {
  const text = typeof passage === 'string' ? passage : '';
  const name = typeof label === 'string' ? label.replace(/\s*\([A-Z][A-Za-z0-9.&/-]{1,15}\)\s*/g, ' ').trim() : '';
  if (!name) return [{ text, emphasis: false }];
  const separator = '\\s+(?:\\([\\p{L}\\p{N}.&/-]{2,16}\\)\\s*)?';
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${name.split(/\s+/).map(escapePattern).join(separator)}(?![\\p{L}\\p{N}])`, 'giu');
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) parts.push({ text: text.slice(end, match.index), emphasis: false });
    parts.push({ text: match[0], emphasis: true });
    end = match.index + match[0].length;
  }
  if (end < text.length || !parts.length) parts.push({ text: text.slice(end), emphasis: false });
  return parts;
}

export default function MemoEvidence({ passage, label }) {
  return evidenceNameParts(passage, label).map((part, index) => part.emphasis
    ? <strong key={index}>{part.text}</strong>
    : <React.Fragment key={index}>{part.text}</React.Fragment>);
}
