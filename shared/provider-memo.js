import { analyzeMemoSource, memoStructure } from './memo-source.js';

/** Filter provider reading text only; saved source and quotation checks retain the original. */
export function prepareProviderMemo(text) {
  const source = analyzeMemoSource(text);
  const ranges = source.bibliographyRanges;
  const parts = [];
  let from = 0;
  for (const range of ranges) {
    parts.push(source.text.slice(from, range.start));
    from = range.end;
  }
  parts.push(source.text.slice(from));
  const sourceText = ranges.length ? parts.filter(part => part.trim()).join('\n\n').trim() : source.text;
  const structure = memoStructure(source);
  return {
    sourceText,
    source,
    ...(structure ? { memoContext: { structure: {
      ...structure,
      ...(ranges.length ? {
        bibliographySectionsOmitted: ranges.length,
        originalCharacterCount: source.text.length,
        offsets: 'Offsets refer to the original saved memo; the listed reference sections are omitted from memoText.',
        omissionNotice: 'Confidently identified reference-list entries were omitted from model input. The complete original memo remains saved unchanged; inline citations and retained narrative remain in memoText.',
      } : {}),
    } } } : {}),
  };
}
