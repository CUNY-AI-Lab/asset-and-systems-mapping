import { describe, expect, it, vi } from 'vitest';
import { extractPdfMemo, extractPdfText, pageText } from './pdfMemo.js';

describe('pageText', () => {
  it('preserves word boundaries in positioned PDF runs and keeps citation punctuation', () => {
    const run = (str, x, width, y = 100) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, dir: 'ltr' });
    expect(pageText([
      run('School', 10, 30), run('support', 43, 35), run(' (Smith,', 78, 38),
      run('2025', 120, 20), run(').', 140, 10),
    ])).toBe('School support (Smith, 2025).');
    expect(pageText([run('com', 10, 15), run('munity', 25, 25), run('1', 50, 3, 104)])).toBe('community1');
  });

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
  it('reports partially scanned pages while keeping citations and page order', async () => {
    const { pdfjs, destroy } = fakePdfjs([
      [{ str: 'The school works with families (Smith, 2025, p. 12).', hasEOL: true }],
      [],
      [{ str: 'References', hasEOL: true }, { str: 'Smith, A. (2025). Community schooling.', hasEOL: true }],
    ]);
    await expect(extractPdfMemo(new ArrayBuffer(4), { maxCharacters: 1000, load: async () => pdfjs })).resolves.toEqual({
      text: 'The school works with families (Smith, 2025, p. 12).\n\nReferences\nSmith, A. (2025). Community schooling.',
      pageCount: 3, emptyPageCount: 1,
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('releases the page and worker when text extraction fails', async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const pdfjs = { getDocument: () => ({ destroy, promise: Promise.resolve({ numPages: 1, getPage: async () => ({
      cleanup, getTextContent: async () => { throw new Error('Unreadable text layer'); },
    }) }) }) };
    await expect(extractPdfMemo(new ArrayBuffer(4), { maxCharacters: 1000, load: async () => pdfjs })).rejects.toThrow('Unreadable text layer');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

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
