// Read the selectable text of a PDF memo in the browser. Nothing leaves the
// device here; the extracted text enters the memo field like a DOCX import.
// Scanned PDFs carry no text layer and return an empty string.
import { taggedPageBlocks, renderPdfBlocks } from './pdfTables.js';

import { pageText } from './pdfText.js';
export { pageText } from './pdfText.js';

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * @param {ArrayBuffer} data
 * @param {{ maxCharacters: number, load?: () => Promise<any> }} options
 * @returns {Promise<{ text: string, pageCount: number, emptyPageCount: number }>}
 */
export async function extractPdfMemo(data, { maxCharacters, load = loadPdfjs }) {
  const pdfjs = await load();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    let length = 0;
    let emptyPageCount = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      let text, blocks;
      try {
        const content = await page.getTextContent({ includeMarkedContent: true });
        text = pageText(content.items);
        const structure = typeof page.getStructTree === 'function' ? await page.getStructTree().catch(() => null) : null;
        blocks = taggedPageBlocks(content.items, structure);
      } finally {
        page.cleanup();
      }
      length += text.length + (text && pages.length ? 2 : 0);
      if (length > maxCharacters) throw new Error('The extracted PDF text is too large.');
      if (text) pages.push(blocks);
      else emptyPageCount += 1;
    }
    const text = renderPdfBlocks(pages);
    if (text.length > maxCharacters) throw new Error('The extracted PDF text is too large.');
    return { text, pageCount: pdf.numPages, emptyPageCount };
  } finally {
    // The loading task owns the worker and document; release both.
    await task.destroy();
  }
}

export async function extractPdfText(data, options) {
  return (await extractPdfMemo(data, options)).text;
}
