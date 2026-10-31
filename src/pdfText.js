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
