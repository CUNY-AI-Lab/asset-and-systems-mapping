import { describe, expect, it, vi } from 'vitest';
import { extractPdfText, pageText } from './pdfMemo.js';

describe('pageText', () => {
  it('keeps recorded line breaks and drops non-text items', () => {
    expect(pageText([
      { str: 'Rosa’s husband works nights', hasEOL: true },
      { str: 'for the transit authority.', hasEOL: false },
      { type: 'beginMarkedContent' },
      { str: ' She leaves at six.', hasEOL: true },
      { str: '', hasEOL: true },
      { str: '', hasEOL: true },
      { str: 'Next paragraph', hasEOL: false },
    ])).toBe('Rosa’s husband works nights\nfor the transit authority. She leaves at six.\n\nNext paragraph');
  });
});

function fakePdfjs(pages) {
  const destroy = vi.fn(async () => {});
  // Mirrors pdf.js 6: destroy() belongs to the loading task, not the document.
  const getDocument = vi.fn(() => ({ destroy, promise: Promise.resolve({
    numPages: pages.length,
    getPage: async number => ({ getTextContent: async () => ({ items: pages[number - 1] }), cleanup: () => {} }),
  }) }));
  return { pdfjs: { getDocument }, destroy, getDocument };
}

describe('extractPdfText', () => {
  it('joins pages, skips empty pages, disables eval and always releases the document', async () => {
    const { pdfjs, destroy, getDocument } = fakePdfjs([[{ str: 'Page one', hasEOL: false }], [], [{ str: 'Page three', hasEOL: false }]]);
    await expect(extractPdfText(new ArrayBuffer(4), { maxCharacters: 1000, load: async () => pdfjs })).resolves.toBe('Page one\n\nPage three');
    expect(getDocument.mock.calls[0][0].isEvalSupported).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns an empty string for a scan with no text layer', async () => {
    const { pdfjs } = fakePdfjs([[], []]);
    await expect(extractPdfText(new ArrayBuffer(4), { maxCharacters: 1000, load: async () => pdfjs })).resolves.toBe('');
  });

  it('stops at the memo size ceiling and still releases the document', async () => {
    const { pdfjs, destroy } = fakePdfjs([[{ str: 'x'.repeat(40), hasEOL: false }], [{ str: 'y'.repeat(40), hasEOL: false }]]);
    await expect(extractPdfText(new ArrayBuffer(4), { maxCharacters: 60, load: async () => pdfjs })).rejects.toThrow('too large');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
