import { relationshipDescription, relationshipArrowheads, relationshipLineWidth, relationshipProcessSummary } from './relationshipDirection.js';

const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
const names = ['Micro', 'Meso', 'Exo', 'Macro'];
const colors = ['#dbeafe', '#d1fae5', '#fef3c7', '#ede9fe'];
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function lines(text, width = 34) {
  const words = String(text).split(/\s+/), result = [''];
  for (const word of words) {
    for (let i = 0; i < word.length; i += width) {
      const chunk = word.slice(i, i + width), last = result.length - 1;
      if ((result[last] + ' ' + chunk).trim().length > width) result.push(chunk);
      else result[last] = (result[last] + ' ' + chunk).trim();
    }
  }
  return result;
}
export function mapExportSvg(project) {
  const liveNodes = project.graph.nodes.filter(node => node.claimState !== 'retired' && node.status !== 'rejected');
  const legacyNodes = liveNodes.filter(node => node.scale === 'meso');
  const nodes = liveNodes.filter(node => node.scale !== 'meso');
  const nodeById = new Map(liveNodes.map(node => [node.id, node]));
  const exportLevels = ['micro', ...['exosphere', 'macrosphere'].filter(scale => nodes.some(node => node.scale === scale))];
  const width = 900 + (exportLevels.length - 1) * 600;
  const positions = new Map(), bottoms = exportLevels.map(() => 150);
  const microBounds = [];
  const cards = nodes.map(node => {
    const col = Math.max(0, exportLevels.indexOf(node.scale)), text = lines(node.label);
    const box = { x: col ? 930 + (col - 1) * 600 : 180, y: bottoms[col], width: 340, height: 32 + text.length * 22 };
    bottoms[col] += box.height + 68;
    positions.set(node.id, box);
    if (node.scale === 'micro') microBounds.push({ left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height });
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${colors[levels.indexOf(node.scale)]}" stroke="#475569"/><text x="${box.x + 14}" y="${box.y + 27}" font-size="17">${text.map((line,i) => `<tspan x="${box.x + 14}" dy="${i ? 22 : 0}">${xml(line)}</tspan>`).join('')}</text></g>`;
  });
  const visibleEdges = project.graph.edges.filter(edge => edge.claimState !== 'retired' && edge.status !== 'rejected' && nodeById.has(edge.source) && nodeById.has(edge.target));
  const edges = [...visibleEdges, ...liveNodes.flatMap(node => [...(node.scopeNodeIds || []).map(id => ({ source: id, target: node.id, verb: 'scope', scope: true })), ...(node.settingNodeIds || []).map(id => ({ source: node.id, target: id, verb: 'setting membership', scope: true }))])];
  const legend = [];
  const paths = edges.flatMap((edge,index) => {
    const source = nodeById.get(edge.source)?.label, target = nodeById.get(edge.target)?.label;
    if (!source || !target) return [];
    const number = legend.length + 1;
    const missing = edge.relationshipProcess?.connectionStatus === 'missing';
    const arrows = relationshipArrowheads(edge);
    const arrowStart = !edge.scope && arrows.start;
    const arrowEnd = !edge.scope && arrows.end;
    const description = edge.scope ? `${source} — ${edge.verb} — ${target}` : relationshipDescription(edge, source, target);
    const details = relationshipProcessSummary({ ...edge.relationshipProcess, direction: '' });
    legend.push(`${number}. ${description}${details ? `; ${details}` : ''}`);
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return [];
    const sameColumn = a.x === b.x;
    const forward = b.x > a.x;
    const x1 = a.x + (sameColumn || forward ? a.width : 0), y1 = a.y + a.height/2;
    const x2 = b.x + (sameColumn || !forward ? b.width : 0), y2 = b.y + b.height/2;
    const lane = sameColumn ? a.x + a.width + 28 + (index % 12)*14 : (x1+x2)/2;
    if (nodeById.get(edge.source).scale === 'micro' && nodeById.get(edge.target).scale === 'micro') {
      microBounds.push({ left: Math.min(x1, x2, lane) - 14, right: Math.max(x1, x2, lane) + 14, top: Math.min(y1, y2) - 14, bottom: Math.max(y1, y2) + 14 });
    }
    return [`<g><path d="M ${x1} ${y1} L ${lane} ${y1} L ${lane} ${y2} L ${x2} ${y2}" fill="none" stroke="#475569" stroke-width="${relationshipLineWidth(edge)}" ${edge.scope || missing ? 'stroke-dasharray="6 4"' : `${arrowStart ? 'marker-start="url(#arrow)"' : ''} ${arrowEnd ? 'marker-end="url(#arrow)"' : ''}`}/><circle cx="${lane}" cy="${(y1+y2)/2}" r="12" fill="white" stroke="#475569"/><text x="${lane}" y="${(y1+y2)/2+5}" text-anchor="middle" font-size="14">${number}</text></g>`];
  });
  const micro = microBounds.length ? (() => {
    const left = Math.min(...microBounds.map(box => box.left)), right = Math.max(...microBounds.map(box => box.right));
    const top = Math.min(...microBounds.map(box => box.top)), bottom = Math.max(...microBounds.map(box => box.bottom));
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, rx: (right - left) / 2 * Math.SQRT2 + 28, ry: (bottom - top) / 2 * Math.SQRT2 + 36 };
  })() : null;
  const offsetY = micro ? Math.max(0, 150 - micro.cy + micro.ry) : 0;
  const microCircle = micro ? `<g data-export-layer="micro"><ellipse cx="${micro.cx}" cy="${micro.cy}" rx="${micro.rx}" ry="${micro.ry}" fill="#f1f5f9" stroke="#2159a8" stroke-width="2"/><rect x="${micro.cx - 190}" y="${micro.cy - micro.ry + 5}" width="380" height="32" rx="16" fill="white" stroke="#2159a8"/><text x="${micro.cx}" y="${micro.cy - micro.ry + 26}" text-anchor="middle" font-size="20" font-weight="bold">Micro items · Meso relationships</text></g>` : '';
  const mapBottom = Math.max(420, ...bottoms, micro ? micro.cy + micro.ry : 0) + offsetY;
  const legendTop = mapBottom + 40;
  const countNote = visibleEdges.some(edge => Number.isInteger(edge.relationshipProcess?.familyCount)) ? ['Wider lines represent more recorded families, up to a fixed maximum. Labels give exact counts and connection strength.'] : [];
  const legacyLines = legacyNodes.length ? ['Preserved Meso records from earlier maps', ...legacyNodes.map(node => `${node.label}${node.scopeNodeIds?.length ? `; includes: ${node.scopeNodeIds.map(id => nodeById.get(id)?.label).filter(Boolean).join(', ')}` : ''}${node.mesoExplanation ? `; ${node.mesoExplanation}` : ''}`)] : [];
  const legendLines = [...legend, ...countNote, ...legacyLines].flatMap(text => lines(text, Math.floor((width - 60) / 10)));
  const height = legendTop + 50 + legendLines.length * 24;
  const headings = exportLevels.filter(scale => scale !== 'micro').map(scale => `<text x="${930 + (exportLevels.indexOf(scale) - 1) * 600}" y="120" font-size="22" font-weight="bold">${names[levels.indexOf(scale)]}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#475569"/></marker></defs><g font-family="Arial, sans-serif" fill="#172033"><text x="30" y="42" font-size="26">${xml(project.title || 'Systems map')}</text><text x="30" y="74" font-size="16">Cumulative map · ${nodes.length} elements · ${visibleEdges.length} relationships · Export audience: ${xml(project.sharingTier)}</text>${headings}<g transform="translate(0 ${offsetY})">${microCircle}${paths.join('')}${cards.join('')}</g><text x="30" y="${legendTop}" font-size="22" font-weight="bold">Relationships and scope</text><text x="30" y="${legendTop+32}" font-size="18">${legendLines.map((line,i)=>`<tspan x="30" dy="${i?24:0}">${xml(line)}</tspan>`).join('')}</text></g></svg>`;
  return { svg, width, height };
}

// One raster page, with no embedded source memo or external resources.
export function imagePdf(jpeg, width, height) {
  const encoder = new TextEncoder(), chunks = [], offsets = [0]; let size = 0;
  const add = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); size += bytes.length; };
  const object = (id, body) => { offsets[id] = size; add(`${id} 0 obj\n`); add(body); add('\nendobj\n'); };
  add('%PDF-1.4\n');
  const pageWidth = 842, pageHeight = Math.max(595, Math.min(14400, pageWidth * height / width));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = size; add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); add(jpeg); add('\nendstream\nendobj\n');
  const scale = Math.min((pageWidth-32)/width, (pageHeight-32)/height), w = width*scale, h = height*scale;
  const content = `q ${w} 0 0 ${h} 16 ${pageHeight-16-h} cm /Im0 Do Q`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let i=1;i<=5;i++) add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
export async function exportMapImage(project, format) {
  const { svg, width, height } = mapExportSvg(project);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try {
    const image = new Image();
    await new Promise((resolve,reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The map image could not be rendered.')); image.src = url; });
    const scale = Math.min(2, 8192/width, 8192/height, Math.sqrt(24000000/(width*height)));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width*scale); canvas.height = Math.ceil(height*scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image export is unavailable in this browser.');
    context.fillStyle = 'white'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height);
    if (format === 'png') return await new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The map image could not be saved.')), 'image/png'));
    const encoded = canvas.toDataURL('image/jpeg',0.94).split(',')[1];
    const jpeg = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    return imagePdf(jpeg,canvas.width,canvas.height);
  } finally { /* SVG data is held only for the duration of rendering. */ }
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
