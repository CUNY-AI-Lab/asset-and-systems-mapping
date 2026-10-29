// Read the selectable text of a PDF memo in the browser. Nothing leaves the
// device here; the extracted text enters the memo field like a DOCX import.
// Scanned PDFs carry no text layer and return an empty string.

/** Join one page's text items, keeping the line breaks the PDF records. */
export function pageText(items) {
  let text = '';
  let previous = null;
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    // PDF writers sometimes position words as separate runs without a space
    // character. Recover a visible gap, while leaving contiguous glyph runs,
    // punctuation and superscript citation markers attached as printed.
    if (previous && !previous.hasEOL && item.str && !/\s$/.test(text) && !/^\s/.test(item.str)
      && item.dir !== 'rtl' && previous.dir !== 'rtl'
      && Array.isArray(previous.transform) && Array.isArray(item.transform)
      && Number.isFinite(previous.width)) {
      const height = Math.max(Math.abs(previous.height || previous.transform[3] || 0), Math.abs(item.height || item.transform[3] || 0));
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      const baseline = Math.abs(item.transform[5] - previous.transform[5]);
      if (height > 0 && baseline <= height * 0.25 && gap > Math.max(0.5, height * 0.12)) text += ' ';
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (item.str || item.hasEOL) previous = item;
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
      let text;
      try {
        text = pageText((await page.getTextContent()).items);
      } finally {
        page.cleanup();
      }
      length += text.length + (text && pages.length ? 2 : 0);
      if (length > maxCharacters) throw new Error('The extracted PDF text is too large.');
      if (text) pages.push(text);
      else emptyPageCount += 1;
    }
    return { text: pages.join('\n\n'), pageCount: pdf.numPages, emptyPageCount };
  } finally {
    // The loading task owns the worker and document; release both.
    await task.destroy();
  }
}

export async function extractPdfText(data, options) {
  return (await extractPdfMemo(data, options)).text;
}
