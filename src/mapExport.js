import { relationshipDescription, relationshipArrowheads, relationshipLineWidth, relationshipProcessSummary } from './relationshipDirection.js';
import { groupedRelationships } from '../shared/relationship-groups.js';

const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
const colors = ['#dbeafe', '#d1fae5', '#e6f4ef', '#ede9fe'];
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
  const exportLevels = nodes.some(node => ['exosphere', 'macrosphere'].includes(node.scale)) ? ['micro', 'exosphere', 'macrosphere'] : ['micro'];
  let width = 900 + (exportLevels.length - 1) * 600;
  const positions = new Map(), bottoms = exportLevels.map(() => 150);
  const microBounds = [];
  const cards = nodes.map(node => {
    const col = exportLevels.indexOf(node.scale), text = lines(node.label);
    const box = { x: col ? 930 + (col - 1) * 600 : 180, y: bottoms[col], width: 340, height: 32 + text.length * 22 };
    bottoms[col] += box.height + 68;
    positions.set(node.id, box);
    if (node.scale === 'micro') microBounds.push({ left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height });
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${colors[levels.indexOf(node.scale)]}" stroke="#475569"/><text x="${box.x + 14}" y="${box.y + 27}" font-size="17">${text.map((line,i) => `<tspan x="${box.x + 14}" dy="${i ? 22 : 0}">${xml(line)}</tspan>`).join('')}</text></g>`;
  });
  const visibleEdges = project.graph.edges.filter(edge => edge.claimState !== 'retired' && edge.status !== 'rejected' && nodeById.has(edge.source) && nodeById.has(edge.target));
  const edges = [...visibleEdges, ...liveNodes.flatMap(node => [...(node.scopeNodeIds || []).map(id => node.scale === 'macrosphere'
    ? { source: node.id, target: id, verb: node.deontic || 'shapes', scope: true }
    : { source: id, target: node.id, verb: 'scope', scope: true }), ...(node.settingNodeIds || []).map(id => ({ source: node.id, target: id, verb: 'setting membership', scope: true }))])];
  const legend = [];
  const anchors = new Map();
  const paths = edges.filter(edge => !edge.relationshipIds?.length).flatMap((edge,index) => {
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
    if (edge.id) anchors.set(edge.id, { x: lane, y: (y1+y2)/2, x1, y1, x2, y2 });
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
  const groupPaths = visibleEdges.filter(edge => edge.relationshipIds?.length).flatMap(edge => {
    const heading = positions.get(edge.source);
    if (!heading) return [];
    const selected = groupedRelationships(edge, visibleEdges).filter(local => anchors.has(local.id));
    const number = legend.length + 1;
    legend.push(`${number}. ${relationshipDescription(edge, nodeById.get(edge.source)?.label)}; selected relationships: ${selected.map(local => relationshipDescription(local, nodeById.get(local.source)?.label, nodeById.get(local.target)?.label)).join('; ')}`);
    const x = heading.x, y = heading.y + heading.height / 2;
    const arrows = relationshipArrowheads(edge);
    return selected.map(local => {
      const a = anchors.get(local.id);
      return `<g data-export-group="${xml(edge.id)}" data-relationship-id="${xml(local.id)}"><path d="M ${x} ${y} L ${a.x} ${a.y1 - 18} L ${a.x} ${a.y2 + 18} Z" fill="#8b5cf6" fill-opacity=".08"/><path d="M ${x} ${y} L ${a.x} ${a.y}" fill="none" stroke="#7c3aed" stroke-width="1.4" stroke-dasharray="6 4" ${arrows.start ? 'marker-start="url(#arrow)"' : ''} ${arrows.end ? 'marker-end="url(#arrow)"' : ''}/><circle cx="${(x+a.x)/2}" cy="${(y+a.y)/2}" r="12" fill="white" stroke="#7c3aed"/><text x="${(x+a.x)/2}" y="${(y+a.y)/2+5}" text-anchor="middle" font-size="14">${number}</text></g>`;
    });
  });
  const surround = (inner, scale) => {
    const boxes = nodes.filter(node => node.scale === scale).map(node => positions.get(node.id));
    const bounds = boxes.map(box => ({ left:box.x-24, right:box.x+box.width+24, top:box.y-24, bottom:box.y+box.height+24 }));
    if (inner) bounds.push({left:inner.cx-inner.rx-24,right:inner.cx+inner.rx+24,top:inner.cy-inner.ry-48,bottom:inner.cy+inner.ry+24});
    if (!bounds.length) return null;
    const left=Math.min(...bounds.map(box=>box.left)),right=Math.max(...bounds.map(box=>box.right));
    const top=Math.min(...bounds.map(box=>box.top)),bottom=Math.max(...bounds.map(box=>box.bottom));
    return {cx:(left+right)/2,cy:(top+bottom)/2,rx:(right-left)/2*Math.SQRT2+20,ry:(bottom-top)/2*Math.SQRT2+24};
  };
  const exo = exportLevels.length > 1 ? surround(micro, 'exosphere') : null;
  const macro = exportLevels.length > 1 ? surround(exo, 'macrosphere') : null;
  const outer = macro || micro;
  const offsetX = outer ? Math.max(0, 30 - outer.cx + outer.rx) : 0;
  const offsetY = outer ? Math.max(0, 120 - outer.cy + outer.ry) : 0;
  if (outer) width = Math.max(width, Math.ceil(outer.cx + outer.rx + offsetX + 30));
  const sphere = (bounds, scale, label, color) => bounds ? `<g data-export-layer="${scale}"><ellipse cx="${bounds.cx}" cy="${bounds.cy}" rx="${bounds.rx}" ry="${bounds.ry}" fill="${scale === 'micro' ? '#f1f5f9' : '#faf7ff'}" stroke="${color}" stroke-width="2"/><rect x="${bounds.cx - 130}" y="${bounds.cy - bounds.ry + 5}" width="260" height="32" rx="16" fill="white" stroke="${color}"/><text x="${bounds.cx}" y="${bounds.cy - bounds.ry + 26}" text-anchor="middle" font-size="20" font-weight="bold">${label}</text></g>` : '';
  const circles = sphere(macro, 'macrosystem', 'Macrosystem', '#805491') + sphere(exo, 'exosphere', 'Exosystem', '#26756d') + sphere(micro, 'micro', 'Microsystem', '#2159a8');
  const mapBottom = Math.max(420, ...bottoms, outer ? outer.cy + outer.ry : 0) + offsetY;
  const legendTop = mapBottom + 40;
  const countNote = visibleEdges.some(edge => Number.isInteger(edge.relationshipProcess?.familyCount)) ? ['Wider lines represent more recorded families, up to a fixed maximum. Labels give exact counts and connection strength.'] : [];
  const legacyLines = legacyNodes.length ? ['Preserved Meso records from earlier maps', ...legacyNodes.map(node => `${node.label}${node.scopeNodeIds?.length ? `; includes: ${node.scopeNodeIds.map(id => nodeById.get(id)?.label).filter(Boolean).join(', ')}` : ''}${node.mesoExplanation ? `; ${node.mesoExplanation}` : ''}`)] : [];
  const legendLines = [...legend, ...countNote, ...legacyLines].flatMap(text => lines(text, Math.floor((width - 60) / 10)));
  const height = legendTop + 50 + legendLines.length * 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#475569"/></marker></defs><g font-family="Arial, sans-serif" fill="#172033"><text x="30" y="42" font-size="26">${xml(project.title || 'Systems map')}</text><text x="30" y="74" font-size="16">Map · ${nodes.length} ${nodes.length === 1 ? 'item' : 'items'} · ${visibleEdges.length} ${visibleEdges.length === 1 ? 'connection' : 'connections'}</text><g transform="translate(${offsetX} ${offsetY})">${circles}${groupPaths.join('')}${paths.join('')}${cards.join('')}</g><text x="30" y="${legendTop}" font-size="22" font-weight="bold">Connections</text><text x="30" y="${legendTop+32}" font-size="18">${legendLines.map((line,i)=>`<tspan x="30" dy="${i?24:0}">${xml(line)}</tspan>`).join('')}</text></g></svg>`;
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
