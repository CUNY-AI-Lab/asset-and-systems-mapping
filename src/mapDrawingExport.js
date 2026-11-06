import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

// Export only the drawing. Never serialize the application, event handlers,
// editor overlays, accessible form content, source passages or external URLs.
const NS = 'http://www.w3.org/2000/svg';
const elements = new Set('svg defs marker mask g ellipse circle path line rect text tspan title desc'.split(' '));
const geometry = new Set('id x y dx dy x1 x2 y1 y2 cx cy rx ry r width height d transform viewBox refX refY markerUnits markerWidth markerHeight orient maskUnits maskContentUnits preserveAspectRatio'.split(' '));
const paint = 'fill stroke fill-opacity stroke-opacity opacity stroke-width stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin fill-rule clip-rule paint-order text-anchor dominant-baseline font-size font-family font-weight font-style letter-spacing vector-effect mask-type'.split(' ');
const skip = '.edge-hit,.scope-influence-hit,.node-selection-ring,.edge-selection-halo,.relationship-draft-preview';
const svgEl = tag => document.createElementNS(NS, tag);

function copyArtwork(source) {
  if (!elements.has(source.localName) || source.matches(skip)) return null;
  const style = getComputedStyle(source);
  if (!['title','desc'].includes(source.localName) && (style.display === 'none' || style.visibility === 'hidden')) return null;
  const el = svgEl(source.localName);
  for (const {name, value} of source.attributes) {
    if (paint.includes(name) && !/url\(|var\(/i.test(value)) el.setAttribute(name,value);
    if (geometry.has(name) || ['data-graph-id','data-edge-id','data-group-member','data-ecology-layer','data-node-color','data-full-label'].includes(name)) el.setAttribute(name,value);
    if (['mask','marker-start','marker-end'].includes(name) && /^url\(#[\w:-]+\)$/.test(value)) el.setAttribute(name,value);
  }
  for (const property of paint) {
    const value = style.getPropertyValue(property);
    if (value && !/url\(|var\(/i.test(value)) el.setAttribute(property,value);
  }
  // Some browsers expose resolved SVG presentation through CSS only.
  if (style.filter?.startsWith('drop-shadow(') && !style.filter.includes('url(')) el.style.filter = style.filter;
  if (source.classList.contains('viewport-layer')) el.removeAttribute('transform');
  for (const child of source.childNodes) {
    if (child.nodeType === 3) el.append(document.createTextNode(child.textContent));
    else if (child.nodeType === 1) { const next = copyArtwork(child); if (next) el.append(next); }
  }
  return el;
}

const fontFiles = new Map();
function embeddedFont(url) {
  if (!fontFiles.has(url)) fontFiles.set(url, (async () => {
    const response = await fetch(url, {credentials:'same-origin'});
    if (!response.ok) throw new Error('The map font could not be loaded. Try downloading again.');
    const blob = await response.blob();
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The map font could not be read.'));
      reader.readAsDataURL(blob);
    });
  })().catch(error => { fontFiles.delete(url); throw error; }));
  return fontFiles.get(url);
}

// Embed the same locally served font subsets as the page, including non-Latin
// glyphs when present. An SVG used as an image cannot load external fonts.
async function typeStyles(text) {
  const points = [...new Set(Array.from(text, c=>c.codePointAt(0)))];
  const faces = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.type !== 5 || !rule.style.fontFamily.includes('Source Sans 3') || rule.style.fontStyle === 'italic') continue;
      const ranges = rule.style.getPropertyValue('unicode-range').split(',').map(range=>range.trim().replace(/^U\+/i,'').split('-').map(hex=>parseInt(hex,16)));
      if (ranges[0]?.every(Number.isFinite) && !points.some(p=>ranges.some(([lo,hi=lo])=>lo<=p && p<=hi))) continue;
      const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
      if (!match) continue;
      const url = new URL(match[1],sheet.href || document.baseURI);
      if (url.origin !== location.origin || !url.pathname.endsWith('.woff2')) continue;
      faces.push(embeddedFont(url.href).then(data=>rule.cssText.replace(match[0], 'url("'+data+'")')));
    }
  }
  return (await Promise.all(faces)).join('\n');
}

export async function captureMapDrawing(draw, title, description='') {
  if (document.fonts) {
    await document.fonts.load('750 22px "Source Sans 3 Variable"',(title || '')+description);
    await document.fonts.ready;
  }
  const host = document.createElement('div');
  host.className = 'map-stage map-stage--notebook';
  host.inert = true;
  host.setAttribute('aria-hidden','true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:700px;opacity:0;pointer-events:none;';
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(()=>root.render(draw()));
    const source = host.querySelector('svg.graph-canvas');
    const layer = source?.querySelector('.viewport-layer');
    if (!layer) throw new Error('The map drawing is unavailable.');
    const box = layer.getBBox();
    const margin = 18;
    const x = Math.floor(box.x-margin), y = Math.floor(box.y-margin);
    const width = Math.max(160,Math.ceil(box.x+box.width+margin)-x);
    const height = Math.max(90,Math.ceil(box.y+box.height+margin)-y);
    const svg = svgEl('svg');
    Object.entries({width,height,viewBox:[x,y,width,height].join(' '),role:'img'}).forEach(([k,v])=>svg.setAttribute(k,v));
    const caption = svgEl('title'); caption.textContent=title || 'Systems map'; svg.append(caption);
    const desc = svgEl('desc'); desc.textContent=description; svg.append(desc);
    const bg=svgEl('rect');
    Object.entries({x,y,width,height,fill:getComputedStyle(source).getPropertyValue('--canvas').trim() || 'white'}).forEach(([k,v])=>bg.setAttribute(k,v));
    svg.append(bg);
    const defs=copyArtwork(source.querySelector('defs')), artwork=copyArtwork(layer);
    const font = await typeStyles(artwork.textContent);
    if (font) { const style=svgEl('style'); style.textContent=font; defs.prepend(style); }
    svg.append(defs,artwork);
    return {svg:new XMLSerializer().serializeToString(svg),width,height};
  } finally { root.unmount();host.remove(); }
}
