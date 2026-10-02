import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureMapText, wrapMapText } from './mapTextGeometry.js';

const glyphWidth = (text) => Array.from(text).reduce((width, character) => width + ({ W: 14, M: 13, i: 3, l: 3, ' ': 4 }[character] ?? 8), 0);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('measured map-label wrapping', () => {
  it('wraps broad glyphs sooner than the same number of narrow glyphs', () => {
    expect(wrapMapText('WWWW', 30, { measure: glyphWidth })).toEqual(['WW', 'WW']);
    expect(wrapMapText('iiii', 30, { measure: glyphWidth })).toEqual(['iiii']);
  });

  it('keeps the complete coordination label inside measured line widths', () => {
    const label = 'Coordination between Community Center and School';
    const lines = wrapMapText(label, 180, { measure: glyphWidth });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(label);
    expect(lines.every((line) => glyphWidth(line.trim()) <= 180)).toBe(true);
    expect(lines.map((line) => line.trim()).join(' ')).toBe(label);
  });

  it('splits a giant unbroken token without truncation or a line cap', () => {
    const label = 'W'.repeat(1000);
    const lines = wrapMapText(label, 56, { measure: glyphWidth });
    expect(lines).toHaveLength(250);
    expect(lines.join('')).toBe(label);
    expect(lines.every((line) => glyphWidth(line) <= 56)).toBe(true);
    expect(lines.some((line) => line.includes('…'))).toBe(false);
  });

  it('preserves Unicode code points when splitting oversized tokens', () => {
    const label = '教育🙂𝄞🧑🏽‍💻café';
    const measure = (value) => Array.from(value).length * 10;
    const lines = wrapMapText(label, 30, { measure });
    expect(lines.join('')).toBe(label);
    expect(lines.flatMap((line) => Array.from(line))).toEqual(Array.from(label));
    expect(lines.every((line) => measure(line) <= 30)).toBe(true);
    expect(lines.some((line) => /\p{Surrogate}/u.test(line))).toBe(false);
  });

  it('preserves horizontal whitespace and explicit empty paragraphs', () => {
    const label = 'first  paragraph\n\nsecond\tparagraph\n';
    const paragraphs = label.split('\n');
    expect(wrapMapText(label, Infinity, { measure: glyphWidth })).toEqual(paragraphs);
    const wrapped = wrapMapText('first  paragraph', 42, { measure: glyphWidth });
    expect(wrapped.join('')).toBe('first  paragraph');
    expect(wrapped.every((line) => glyphWidth(line.trim()) <= 42)).toBe(true);
    expect(wrapMapText('first\r\n\r\nsecond', Infinity, { measure: glyphWidth })).toEqual(['first', '', 'second']);
  });

  it('returns a safe blank line for missing labels and handles tiny bounds', () => {
    expect(wrapMapText('', 120)).toEqual(['']);
    expect(wrapMapText(null, 120)).toEqual(['']);
    expect(wrapMapText(undefined, 120)).toEqual(['']);
    expect(wrapMapText('W🙂', 0, { measure: glyphWidth })).toEqual(['W', '🙂']);
  });

  it('retains separators without producing whitespace-only soft-wrap lines', () => {
    const label = '  WW WW  WW  ';
    const lines = wrapMapText(label, 28, { measure: glyphWidth });
    expect(lines).toEqual(['  WW ', 'WW  ', 'WW  ']);
    expect(lines.every((line) => /\S/u.test(line))).toBe(true);
    expect(lines.every((line) => glyphWidth(line.trim()) <= 28)).toBe(true);
    expect(lines.join('')).toBe(label);
    expect(lines.map((line) => line.trim()).join(' ')).toBe('WW WW WW');
  });

  it('does not discard the visible width of nonbreaking Unicode spaces', () => {
    const label = 'WW\u00a0WW';
    const lines = wrapMapText(label, 28, { measure: glyphWidth });
    expect(lines.join('')).toBe(label);
    expect(lines.every((line) => glyphWidth(line) <= 28)).toBe(true);
  });

  it('passes explicit font settings to the injected measurer', () => {
    const measure = vi.fn(glyphWidth);
    wrapMapText('a label', 100, { fontSize: 26, fontWeight: 750, fontFamily: 'Example', measure });
    expect(measure).toHaveBeenCalledWith('a', 26, 750, 'Example');
    expect(measure).toHaveBeenCalledWith('a label', 26, 750, 'Example');
  });
});

describe('cached map-label measurement', () => {
  function stubBrowser({ fonts } = {}) {
    const measureText = vi.fn((text) => ({ width: glyphWidth(text) }));
    const context = { font: '', measureText };
    const getContext = vi.fn(() => context);
    const createElement = vi.fn(() => ({ getContext }));
    vi.stubGlobal('document', { createElement, fonts, defaultView: { navigator: { userAgent: 'Test browser' } } });
    return { context, measureText, createElement, getContext };
  }

  it('uses the actual canvas metric and caches by complete font settings', () => {
    const { context, measureText } = stubBrowser();
    expect(measureMapText('Wi', 16, 750, 'Example')).toBe(17);
    expect(context.font).toBe('750 16px Example');
    expect(measureMapText('Wi', 16, 750, 'Example')).toBe(17);
    expect(measureText).toHaveBeenCalledTimes(1);
    measureMapText('Wi', 26, 750, 'Example');
    measureMapText('Wi', 26, 700, 'Example');
    measureMapText('Wi', 26, 700, 'Other font');
    expect(measureText).toHaveBeenCalledTimes(4);
  });

  it('invalidates widths when fonts load or their readiness changes', async () => {
    const handlers = new Map();
    let resolveFonts;
    const fonts = {
      status: 'loading',
      check: vi.fn(() => false),
      ready: new Promise((resolve) => { resolveFonts = resolve; }),
      addEventListener: vi.fn((event, callback) => handlers.set(event, callback)),
      removeEventListener: vi.fn(),
    };
    const { measureText } = stubBrowser({ fonts });
    expect(measureMapText('Wi')).toBe(17);
    measureText.mockReturnValue({ width: 23 });
    expect(measureMapText('Wi')).toBe(17);
    fonts.status = 'loaded';
    fonts.check.mockReturnValue(true);
    expect(measureMapText('Wi')).toBe(23);
    measureText.mockReturnValue({ width: 25 });
    handlers.get('loadingdone')();
    expect(measureMapText('Wi')).toBe(25);
    measureText.mockReturnValue({ width: 27 });
    resolveFonts();
    await Promise.resolve();
    expect(measureMapText('Wi')).toBe(27);
  });

  it('bounds the cache deterministically instead of retaining every label', () => {
    const { measureText } = stubBrowser();
    measureMapText('first label');
    for (let index = 0; index < 2048; index += 1) measureMapText(`label ${index}`);
    const calls = measureText.mock.calls.length;
    measureMapText('first label');
    expect(measureText).toHaveBeenCalledTimes(calls + 1);
  });

  it('avoids jsdom canvas calls and their not-implemented console noise', () => {
    const canvas = vi.spyOn(document, 'createElement');
    const consoleError = vi.spyOn(console, 'error');
    expect(measureMapText('A safe fallback', 16)).toBeGreaterThanOrEqual(14 * 8);
    expect(measureMapText('')).toBe(0);
    expect(canvas).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('also measures conservatively without any document', () => {
    vi.stubGlobal('document', undefined);
    expect(measureMapText('🙂W', 20)).toBe(46);
    expect(measureMapText(null)).toBe(0);
    expect(wrapMapText('still complete', 50).join('')).toBe('still complete');
  });

  it('uses conservative glyph classes instead of treating every Latin letter as wide', () => {
    vi.stubGlobal('document', undefined);
    expect(measureMapText('WW', 20)).toBeCloseTo(44);
    expect(measureMapText('aa', 20)).toBeCloseTo(28);
    expect(measureMapText('ii', 20)).toBeCloseTo(16);
    expect(measureMapText('AA', 20)).toBeCloseTo(32);
    expect(measureMapText('教育🙂', 20)).toBeCloseTo(72);
    const label = 'School–family coordination';
    const lines = wrapMapText(label, 196, { fontSize: 18, fontWeight: 750 });
    expect(lines).toEqual(['School–family ', 'coordination']);
    expect(lines.join('')).toBe(label);
    expect(lines.every((line) => measureMapText(line.trim(), 18, 750) <= 196)).toBe(true);
  });
});
