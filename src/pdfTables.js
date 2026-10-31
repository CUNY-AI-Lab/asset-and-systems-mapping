import { pageText } from './pdfText.js';

const compact = value => value.replace(/\s+/gu, ' ').trim();
const contentIds = node => node?.type === 'content' ? [node.id] : (node?.children || []).flatMap(contentIds);

/** Use PDF accessibility tags, rather than guessed page coordinates, for cells. */
export function taggedPageBlocks(items, structure) {
  const tables = [];
  const visit = node => {
    if (node?.role === 'Table') tables.push(node);
    else (node?.children || []).forEach(visit);
  };
  visit(structure);
  if (!tables.length) return [{ text: pageText(items) }];
  const marked = new Map(), stack = [];
  items.forEach((item, index) => {
    if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') stack.push(item.id || null);
    else if (item.type === 'endMarkedContent') stack.pop();
    else if (typeof item.str === 'string') for (const id of stack.filter(Boolean)) {
      if (!marked.has(id)) marked.set(id, []);
      marked.get(id).push({ item, index });
    }
  });
  const spans = [];
  for (const table of tables) {
    // Nested/irregular tables keep the existing text extraction path.
    const rows = table.children || [];
    if (!rows.length || rows.some(row => row.role !== 'TR' || !row.children?.length || row.children.some(cell => !['TH', 'TD'].includes(cell.role)))) return [{ text: pageText(items) }];
    const positions = contentIds(table).flatMap(id => (marked.get(id) || []).map(entry => entry.index));
    if (!positions.length) continue;
    const cells = rows.map(row => row.children.map(cell => pageText(contentIds(cell).flatMap(id => (marked.get(id) || []).map(entry => entry.item)))));
    spans.push({ covered: new Set(positions), start: Math.min(...positions), end: Math.max(...positions) + 1,
      table: { cells, header: rows[0].children.every(cell => cell.role === 'TH') } });
  }
  const blocks = [];
  let from = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start < from) return [{ text: pageText(items) }];
    // Retain any text inside the span that was not represented by table tags.
    const covered = span.covered;
    if (items.slice(span.start, span.end).some((item, offset) => item.str?.trim() && !covered.has(span.start + offset))) return [{ text: pageText(items) }];
    const before = pageText(items.slice(from, span.start));
    if (before) blocks.push({ text: before });
    blocks.push({ table: span.table });
    from = span.end;
  }
  const after = pageText(items.slice(from));
  if (after) blocks.push({ text: after });
  return blocks;
}

const filledRows = table => table.cells.flatMap((row, i) => row.some(cell => cell.trim()) ? [i] : []);
const sameShape = (a, b) => a.cells.length === b.cells.length && a.cells.every((row, i) => row.length === b.cells[i].length);

/** Join only tagged continuation rows, preserving every cell's words. */
export function renderPdfBlocks(pages) {
  const blocks = [];
  for (const [pageIndex, page] of pages.entries()) for (const block of page) {
    const current = block.table;
    if (!current) { if (block.text) blocks.push({ text: block.text }); continue; }
    const lastTableIndex = blocks.findLastIndex(entry => entry.table);
    const prior = blocks[lastTableIndex]?.table;
    const first = filledRows(current)[0];
    const last = prior ? filledRows(prior).at(-1) : undefined;
    const intervening = blocks.slice(lastTableIndex + 1).map(entry => entry.text || '').join(' ');
    const repeatedHeader = prior?.header ? compact(prior.cells[0].join(' ')) : '';
    const continuation = prior && blocks[lastTableIndex].pageIndex === pageIndex - 1 && prior.header && current.header && sameShape(prior, current)
      && first > 0 && !current.cells[0].some(Boolean) && [last, last + 1].includes(first)
      && (!compact(intervening) || compact(intervening) === repeatedHeader);
    if (continuation) {
      current.cells.forEach((row, i) => row.forEach((cell, j) => {
        if (cell) prior.cells[i][j] = [prior.cells[i][j], cell].filter(Boolean).join('\n');
      }));
      blocks[lastTableIndex].pageIndex = pageIndex;
      blocks.splice(lastTableIndex + 1);
    } else blocks.push({ pageIndex, table: { header: current.header, cells: current.cells.map(row => [...row]) } });
  }
  return blocks.map(block => {
    if (block.text !== undefined) return block.text;
    const rows = block.table.cells.filter(row => row.some(Boolean));
    const lines = rows.map(row => '| ' + row.map(cell => compact(cell).replaceAll('|', '\\|')).join(' | ') + ' |');
    if (block.table.header && lines.length) lines.splice(1, 0, '| ' + rows[0].map(() => '---').join(' | ') + ' |');
    return lines.join('\n');
  }).filter(Boolean).join('\n\n');
}
