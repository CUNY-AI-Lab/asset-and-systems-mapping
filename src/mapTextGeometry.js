const DEFAULT_FONT_FAMILY = '"Source Sans 3 Variable", "Source Sans 3", sans-serif';
const MAX_CACHED_WIDTHS = 2048;
const widthCache = new Map();

let currentDocument;
let canvasContext;
let currentFonts;
let currentFontsReady;
let fontGeneration = 0;

function cacheWidth(cache, key, width) {
  if (cache.size >= MAX_CACHED_WIDTHS) cache.delete(cache.keys().next().value);
  cache.set(key, width);
  return width;
}

function invalidateWidths() {
  fontGeneration += 1;
  widthCache.clear();
}

function fontSizePixels(fontSize) {
  const size = Number(fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

// Prefer an extra line to an underestimated card in SSR and DOM-only tests.
function fallbackWidth(text, fontSize) {
  return Array.from(text).reduce((width, character) => {
    if (/\p{Mark}|[\u200b\u200c\u200d\ufe0e\ufe0f]/u.test(character)) return width;
    if (/\s/u.test(character)) return width + fontSize * (character === '\t' ? 2 : 0.5);
    let glyphWidth = 1.1;
    if (character.codePointAt(0) >= 0x2e80) glyphWidth = 1.2;
    else if (/[WMwm]/u.test(character)) glyphWidth = 1.1;
    else if (/[iljI]/u.test(character)) glyphWidth = 0.4;
    else if (/[frt]/u.test(character)) glyphWidth = 0.45;
    else if (/[.,:;!'`|\-\/\\()[\]{}]/u.test(character)) glyphWidth = 0.5;
    else if (/\p{Script=Latin}/u.test(character) && /\p{Uppercase_Letter}/u.test(character)) glyphWidth = 0.8;
    else if (/\p{Script=Latin}/u.test(character) && /\p{Lowercase_Letter}/u.test(character)) glyphWidth = 0.7;
    else if (/\p{Number}/u.test(character)) glyphWidth = 0.7;
    else if (character === '–') glyphWidth = 0.7;
    return width + fontSize * glyphWidth;
  }, 0);
}

function getMeasurementEnvironment() {
  const ownerDocument = globalThis.document;
  if (ownerDocument !== currentDocument) {
    currentFonts?.removeEventListener?.('loadingdone', invalidateWidths);
    currentFonts?.removeEventListener?.('loadingerror', invalidateWidths);
    currentDocument = ownerDocument;
    canvasContext = undefined;
    currentFonts = undefined;
    currentFontsReady = undefined;
    invalidateWidths();
  }

  const fonts = ownerDocument?.fonts;
  if (fonts !== currentFonts) {
    currentFonts?.removeEventListener?.('loadingdone', invalidateWidths);
    currentFonts?.removeEventListener?.('loadingerror', invalidateWidths);
    currentFonts = fonts;
    currentFontsReady = undefined;
    fonts?.addEventListener?.('loadingdone', invalidateWidths);
    fonts?.addEventListener?.('loadingerror', invalidateWidths);
    invalidateWidths();
  }
  if (fonts?.ready && fonts.ready !== currentFontsReady) {
    currentFontsReady = fonts.ready;
    const observedFonts = fonts;
    Promise.resolve(fonts.ready).then(() => {
      if (currentFonts === observedFonts) invalidateWidths();
    }, () => {
      if (currentFonts === observedFonts) invalidateWidths();
    });
  }

  if (canvasContext === undefined) {
    canvasContext = null;
    const userAgent = ownerDocument?.defaultView?.navigator?.userAgent || globalThis.navigator?.userAgent || '';
    // Calling jsdom's unimplemented getContext emits an error even inside try/catch.
    if (ownerDocument?.createElement && !/jsdom/i.test(userAgent)) {
      try {
        canvasContext = ownerDocument.createElement('canvas').getContext('2d');
      } catch {
        // A disabled canvas still gets deterministic, conservative geometry.
      }
    }
  }
  return { context: canvasContext, fonts };
}

/** Measure SVG label text in pixels using the same font as the rendered label. */
export function measureMapText(text, fontSize = 16, fontWeight = 700, fontFamily = DEFAULT_FONT_FAMILY) {
  const label = text == null ? '' : String(text);
  if (!label) return 0;
  const size = fontSizePixels(fontSize);
  const font = `${fontWeight} ${size}px ${fontFamily}`;
  const { context, fonts } = getMeasurementEnvironment();
  let fontLoaded = '';
  try {
    fontLoaded = fonts?.check?.(font, label) ?? '';
  } catch {
    // FontFaceSet.check is optional; loading events and ready still invalidate.
  }
  const key = JSON.stringify([fontGeneration, fonts?.status || '', fontLoaded, font, label]);
  if (widthCache.has(key)) return widthCache.get(key);
  let width;
  if (context) {
    context.font = font;
    width = context.measureText(label).width;
  }
  if (!Number.isFinite(width) || width < 0) width = fallbackWidth(label, size);
  return cacheWidth(widthCache, key, width);
}

/**
 * Wrap without a line cap or ellipsis. Horizontal whitespace remains in the
 * returned strings, but boundary whitespace is excluded from visible width
 * just as it is in SVG's default whitespace processing. Explicit line breaks
 * (including empty paragraphs) remain line boundaries. An indivisible code
 * point wider than maxWidth is retained
 * on its own line, so callers can enlarge that unusually narrow container.
 */
export function wrapMapText(text, maxWidth, {
  fontSize = 16,
  fontWeight = 700,
  fontFamily = DEFAULT_FONT_FAMILY,
  measure = measureMapText,
} = {}) {
  const label = text == null ? '' : String(text);
  const size = fontSizePixels(fontSize);
  const requestedWidth = Number(maxWidth);
  const widthLimit = requestedWidth === Infinity ? Infinity : Math.max(1, Number.isFinite(requestedWidth) ? requestedWidth : 1);
  const localWidths = new Map();
  const widthOf = (value) => {
    const visibleText = value.replace(/^[ \t]+|[ \t]+$/gu, '');
    if (localWidths.has(visibleText)) return localWidths.get(visibleText);
    const measured = measure(visibleText, size, fontWeight, fontFamily);
    const width = Number.isFinite(measured) && measured >= 0 ? measured : fallbackWidth(visibleText, size);
    return cacheWidth(localWidths, visibleText, width);
  };
  const lines = [];

  for (const paragraph of label.split(/\r\n|\r|\n/u)) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    const flush = () => {
      if (line) lines.push(line);
      line = '';
    };
    for (const token of paragraph.match(/\s+|\S+/gu) || []) {
      if (widthOf(line + token) <= widthLimit) {
        line += token;
        continue;
      }
      // Keep a word intact if it fits on a fresh line. Whitespace is split only
      // when necessary, preserving all input characters at soft boundaries.
      if (!/^\s+$/u.test(token) && /\S/u.test(line)) flush();
      for (const character of token) {
        if (line && widthOf(line + character) > widthLimit) flush();
        line += character;
        if (widthOf(line) > widthLimit) flush();
      }
    }
    flush();
  }
  return lines.length ? lines : [''];
}
