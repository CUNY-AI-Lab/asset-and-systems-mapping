export async function readMemoFile(file, { maxCharacters = 500_000 } = {}) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (result.value.length > maxCharacters) throw new Error(`The extracted DOCX text is too large. Use an excerpt of ${maxCharacters.toLocaleString()} characters or fewer.`);
    return { text: result.value, notice: result.messages.length ? 'DOCX imported with conversion notices; compare against the original.' : 'DOCX text imported.' };
  }
  if (['txt', 'md', 'html', 'htm', 'json'].includes(extension)) {
    const raw = await file.text();
    if (extension === 'html' || extension === 'htm') {
      const text = new DOMParser().parseFromString(raw, 'text/html').body.textContent || '';
      if (text.length > maxCharacters) throw new Error(`The extracted HTML text is too large. Use an excerpt of ${maxCharacters.toLocaleString()} characters or fewer.`);
      return { text, notice: 'HTML text imported.' };
    }
    if (raw.length > maxCharacters) throw new Error(`The text is too large. Use ${maxCharacters.toLocaleString()} characters or fewer.`);
    return { text: raw, notice: `${extension.toUpperCase()} memo imported.` };
  }
  if (extension === 'pdf') {
    const { extractPdfMemo } = await import('./pdfMemo.js');
    const { text, pageCount, emptyPageCount } = await extractPdfMemo(await file.arrayBuffer(), { maxCharacters: maxCharacters });
    if (!text.trim()) return { text: '', notice: 'No text could be read from this PDF. Paste the memo text or upload a DOCX.' };
    const notice = pageCount > 1 ? `PDF text imported from ${pageCount} pages.` : 'PDF text imported.';
    const missing = emptyPageCount ? ` ${emptyPageCount} ${emptyPageCount === 1 ? 'page contains' : 'pages contain'} no selectable text; compare with the original and paste any missing passages.` : '';
    return { text, notice: notice + missing };
  }
  throw new Error('You can import DOCX, PDF, TXT, MD, HTML, or JSON files.');
}
