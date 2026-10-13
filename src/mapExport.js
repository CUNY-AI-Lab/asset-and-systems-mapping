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
  const nodes = project.graph.nodes.filter(n => n.claimState !== 'retired' && n.status !== 'rejected');
  const positions = new Map(), bottoms = levels.map(() => 150), width = 2400;
  const cards = nodes.map(node => {
    const col = Math.max(0, levels.indexOf(node.scale)), text = lines(node.label);
    const box = { x: 30 + col * 600, y: bottoms[col], width: 340, height: 32 + text.length * 22 };
    bottoms[col] += box.height + 68; positions.set(node.id, box);
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${colors[col]}" stroke="#475569"/><text x="${box.x + 14}" y="${box.y + 27}" font-size="17">${text.map((line,i) => `<tspan x="${box.x + 14}" dy="${i ? 22 : 0}">${xml(line)}</tspan>`).join('')}</text></g>`;
  });
  const visibleEdges = project.graph.edges.filter(e => e.claimState !== 'retired' && e.status !== 'rejected' && positions.has(e.source) && positions.has(e.target));
  const edges = [...visibleEdges, ...nodes.flatMap(n => [...(n.scopeNodeIds || []).map(id => ({ source: id, target: n.id, verb: 'scope', scope: true })), ...(n.settingNodeIds || []).map(id => ({ source: n.id, target: id, verb: 'setting membership', scope: true }))])];
  const legend = [];
  const paths = edges.flatMap((edge,index) => {
    const a = positions.get(edge.source), b = positions.get(edge.target);
    if (!a || !b) return [];
    const sameColumn = a.x === b.x;
    const forward = b.x > a.x;
    const x1 = a.x + (sameColumn || forward ? a.width : 0), y1 = a.y + a.height/2;
    const x2 = b.x + (sameColumn || !forward ? b.width : 0), y2 = b.y + b.height/2;
    const lane = sameColumn ? a.x + a.width + 28 + (index % 12)*14 : (x1+x2)/2;
    const source = nodes.find(n=>n.id===edge.source)?.label, target = nodes.find(n=>n.id===edge.target)?.label;
    const number = legend.length+1;
    legend.push(`${number}. ${source} ${edge.scope ? '— '+edge.verb+' —' : '— '+(edge.verb || edge.label || 'connects')+(edge.directed === false ? ' —' : ' →')} ${target}`);
    return [`<g><path d="M ${x1} ${y1} L ${lane} ${y1} L ${lane} ${y2} L ${x2} ${y2}" fill="none" stroke="#475569" stroke-width="2" ${edge.scope ? 'stroke-dasharray="6 4"' : edge.directed === false ? '' : 'marker-end="url(#arrow)"'}/><circle cx="${lane}" cy="${(y1+y2)/2}" r="12" fill="white" stroke="#475569"/><text x="${lane}" y="${(y1+y2)/2+5}" text-anchor="middle" font-size="14">${number}</text></g>`];
  });
  const legendTop = Math.max(420, ...bottoms) + 30;
  const legendLines = legend.flatMap(text=>lines(text,180));
  const height = legendTop + 50 + legendLines.length*24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#475569"/></marker></defs><g font-family="Arial, sans-serif" fill="#172033"><text x="30" y="42" font-size="26">${xml(project.title || 'Systems map')}</text><text x="30" y="74" font-size="16">Cumulative map · ${nodes.length} elements · ${visibleEdges.length} relationships · Export audience: ${xml(project.sharingTier)}</text>${levels.map((_,i) => `<text x="${30+i*600}" y="120" font-size="22" font-weight="bold">${names[i]}</text>`).join('')}${paths.join('')}${cards.join('')}<text x="30" y="${legendTop}" font-size="22" font-weight="bold">Relationships and scope</text><text x="30" y="${legendTop+32}" font-size="18">${legendLines.map((line,i)=>`<tspan x="30" dy="${i?24:0}">${xml(line)}</tspan>`).join('')}</text></g></svg>`;
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
