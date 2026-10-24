// Read the selectable text of a PDF memo in the browser. Nothing leaves the
// device here; the extracted text enters the memo field like a DOCX import.
// Scanned PDFs carry no text layer and return an empty string.

/** Join one page's text items, keeping the line breaks the PDF records. */
export function pageText(items) {
  let text = '';
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

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
 * @returns {Promise<string>}
 */
export async function extractPdfText(data, { maxCharacters, load = loadPdfjs }) {
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
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const text = pageText((await page.getTextContent()).items);
      page.cleanup();
      length += text.length + 2;
      if (length > maxCharacters) throw new Error('The extracted PDF text is too large.');
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  } finally {
    // The loading task owns the worker and document; release both.
    await task.destroy();
  }
}
