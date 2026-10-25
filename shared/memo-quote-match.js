// Decide whether a generated evidence excerpt quotes the student's memo.
//
// Memos arrive from Word, Google Docs and pasted web text, so the same passage
// can differ only in typography: curly versus straight quotes, em dashes versus
// hyphens, a single ellipsis character versus three dots, letter case, or
// non-breaking spaces. Models routinely normalize those marks when they quote.
// This matcher tolerates typography and elided gaps ("...") between verbatim
// fragments. It never accepts paraphrase: every fragment must still occur in
// the memo, in order.

const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;
const ELLIPSIS = /…/g;
const GAP = /\s*(?:\.\s*\.\s*\.|\[\s*(?:\.\s*\.\s*\.)\s*\])\s*/;
const EDGE_MARKS = /^[\s"'\-]+|[\s"'\-]+$/g;
const MIN_FRAGMENT_CHARACTERS = 4;

export function canonicalQuoteText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(ELLIPSIS, '...')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

/** True when every non-elided fragment of the excerpt occurs in the memo, in order. */
export function excerptQuotesMemo(memo, excerpt) {
  const source = canonicalQuoteText(memo);
  const fragments = canonicalQuoteText(excerpt)
    .split(GAP)
    .map(fragment => fragment.replace(EDGE_MARKS, ''))
    .filter(Boolean);
  if (!fragments.length || fragments.some(fragment => fragment.length < MIN_FRAGMENT_CHARACTERS)) return false;
  let from = 0;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}
