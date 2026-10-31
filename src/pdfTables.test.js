import { describe, expect, it } from 'vitest';
import { taggedPageBlocks, renderPdfBlocks } from './pdfTables.js';
import { extractPdfMemo } from './pdfMemo.js';

const cell = (text, id) => ({ role: 'TD', children: text ? [{ type: 'content', id }] : [] });
const row = (values, prefix, header = false) => ({ role: 'TR', children: values.map((value, i) => ({ ...cell(value, `${prefix}_${i}`), role: header ? 'TH' : 'TD' })) });
function page(rows, prefix, before = '', after = '') {
  const table = { role: 'Table', children: rows.map((values, i) => row(values, `${prefix}_${i}`, i === 0)) };
  const items = before ? [{ str: before, hasEOL: true }] : [];
  rows.forEach((values, i) => values.forEach((value, j) => {
    if (value) items.push({ type: 'beginMarkedContentProps', id: `${prefix}_${i}_${j}` }, { str: value, hasEOL: true }, { type: 'endMarkedContent' });
  }));
  if (after) items.push({ str: after, hasEOL: true });
  return { items, structure: { role: 'Root', children: [table] } };
}
const blocks = p => taggedPageBlocks(p.items, p.structure);

describe('tagged PDF tables', () => {
  it('joins a cell continued across pages while retaining prose, references and every populated row', async () => {
    const pages = [page([['People','Method'],['Parent and teacher','Phone and'],['','']], 'p1', 'A memo'),
      page([['',''],['','school meetings'],['Nurse and teacher','Email']], 'p2', 'People\nMethod', 'References: A source')];
    const destroy = async () => {};
    const result = await extractPdfMemo(new ArrayBuffer(0), { maxCharacters: 10000, load: async () => ({ getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async n => ({ getTextContent: async () => ({ items: pages[n-1].items }), getStructTree: async () => pages[n-1].structure, cleanup() {} }) }), destroy }) }) });
    expect(result).toMatchObject({ pageCount: 2, emptyPageCount: 0 });
    expect(result.text).toBe('A memo\n\n| People | Method |\n| --- | --- |\n| Parent and teacher | Phone and school meetings |\n| Nurse and teacher | Email |\n\nReferences: A source');
  });
  it('keeps independent tables and intervening narrative separate', () => {
    const a = blocks(page([['People','Method'],['Parent','Phone']], 'a'));
    const b = blocks(page([['People','Method'],['Nurse','Email']], 'b', 'A separate observation'));
    const result = renderPdfBlocks([a,b]);
    expect(result.match(/\| People \| Method \|/g)).toHaveLength(2);
    expect(result).toContain('A separate observation');
  });
  it('keeps separate same-page tables even when their cell shapes match', () => {
    const a=blocks(page([['People','Method'],['Parent','Phone']], 'a'));
    const b=blocks(page([['',''],['Nurse','Email']], 'b'));
    const result=renderPdfBlocks([[...a,...b]]);
    expect(result).not.toContain('Parent Nurse');
    expect(result).toContain('| Nurse | Email |');
  });
  it('retains untagged text rather than silently dropping content inside a table span', () => {
    const p = page([['People','Method'],['Parent','Phone']], 'a');
    p.items.splice(3,0,{ str:'Unmarked qualification', hasEOL:true });
    const result = blocks(p);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('Unmarked qualification');
    expect(result[0].text).toContain('Phone');
  });
  it('falls back to ordinary reading order for irregular or absent table tags', () => {
    expect(taggedPageBlocks([{str:'Ordinary prose',hasEOL:true}],null)).toEqual([{text:'Ordinary prose'}]);
    const p=page([['Header'],['Value']],'a'); p.structure.children[0].children[1].role='P';
    expect(blocks(p)).toEqual([{text:'Header\nValue'}]);
  });
});
