// One raster page, with no embedded source memo or external resources.
export function imagePdf(jpeg, width, height) {
  const encoder = new TextEncoder(), chunks = [], offsets = [0]; let size = 0;
  const add = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); size += bytes.length; };
  const object = (id, body) => { offsets[id] = size; add(`${id} 0 obj\n`); add(body); add('\nendobj\n'); };
  add('%PDF-1.4\n');
  const scale = 842 / Math.max(width,height), pageWidth = width*scale, pageHeight = height*scale;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = size; add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`); add(jpeg); add('\nendstream\nendobj\n');
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (let i=1;i<=5;i++) add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
export async function exportMapImage({ svg, width, height }, format) {
  if (format === 'svg') return new Blob([svg], {type:'image/svg+xml'});
  if (!['png','pdf'].includes(format)) throw new Error('Choose a map image format.');
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
