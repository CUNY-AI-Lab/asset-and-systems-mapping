// Decide whether a generated evidence excerpt quotes the student's memo, and
// how closely.
//
// Memos arrive from Word, Google Docs and pasted web text, so the same passage
// can differ only in typography: curly versus straight quotes, em dashes versus
// hyphens, a single ellipsis character versus three dots, letter case, or
// non-breaking spaces. Models routinely normalize those marks when they quote.
// The matcher reports one of three grades so callers can keep the model's
// quotation verbatim and still tell a reader how it was matched:
//
//   'exact'      the excerpt occurs in the memo as written (whitespace and
//                Unicode NFC aside, as before)
//   'normalized' the excerpt occurs once typography and case are canonicalized
//   'elided'     one or more retained fragments with "..." or "[...]"
//                omission markers, each found in memo order
//
// Paraphrase never matches: every fragment must still occur in the memo.

export const EVIDENCE_MATCH_KINDS = Object.freeze(['exact', 'normalized', 'elided']);

const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;
const ELLIPSIS = /…/g;
const GAP = /\s*(?:\.\s*\.\s*\.|\[\s*(?:\.\s*\.\s*\.)\s*\])\s*/;
const EDGE_MARKS = /^[\s"'\-]+|[\s"'\-]+$/g;
const MIN_FRAGMENT_CHARACTERS = 4;

// A quotation may read adjacent table cells as prose. Remove only structural
// Markdown separators in a recognized table; literal bars and word order stay.
export function tableReadingText(value) {
  const lines = String(value).split('\n');
  const cells = line => /^\s*\|.*\|\s*$/u.test(line)
    ? line.trim().slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim()) : null;
  let width = 0;
  return lines.map((line, index) => {
    const row = cells(line);
    if (!row) { width = 0; return line; }
    const next = cells(lines[index + 1] || '');
    if (next?.length === row.length && next.every(cell => /^:?-+:?$/u.test(cell))) width = row.length;
    if (row.length !== width) { width = 0; return line; }
    if (row.every(cell => /^:?-+:?$/u.test(cell))) return '';
    return row.join(' ');
  }).join('\n');
}

/** The pre-existing strict comparison: Unicode NFC and collapsed whitespace only. */
export function strictQuoteText(value) {
  return String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function canonicalQuoteText(value) {
  return tableReadingText(value)
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(ELLIPSIS, '...')
    // Add dash spacing before collapsing whitespace. Matching optional
    // whitespace around a missing dash rescans long redacted reference lists.
    .replace(/-/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/**
 * Grade how an excerpt quotes the memo.
 * @returns {'exact'|'normalized'|'elided'|null} null when the memo does not support the excerpt
 */
export function classifyExcerptMatch(memo, excerpt) {
  const strictExcerpt = strictQuoteText(excerpt);
  if (!strictExcerpt) return null;
  if (strictQuoteText(memo).includes(strictExcerpt)) return 'exact';
  const source = canonicalQuoteText(memo);
  const canonicalExcerpt = canonicalQuoteText(excerpt).replace(EDGE_MARKS, '');
  // A literal ellipsis in the memo is punctuation, not necessarily an omission.
  if (canonicalExcerpt.length >= MIN_FRAGMENT_CHARACTERS && source.includes(canonicalExcerpt)) return 'normalized';
  const pieces = canonicalExcerpt.split(GAP);
  if (pieces.length === 1) return null;
  const fragments = pieces
    .map(fragment => fragment.replace(EDGE_MARKS, ''))
    .filter(Boolean);
  if (!fragments.length || fragments.some(fragment => fragment.length < MIN_FRAGMENT_CHARACTERS)) return null;
  let from = 0;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, from);
    if (at === -1) return null;
    from = at + fragment.length;
  }
  return 'elided';
}

/** True when the memo supports the excerpt at any grade. */
export function excerptQuotesMemo(memo, excerpt) {
  return classifyExcerptMatch(memo, excerpt) !== null;
}
