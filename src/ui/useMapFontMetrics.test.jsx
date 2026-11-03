import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMapFontMetrics } from './useMapFontMetrics.js';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

afterEach(() => {
  cleanup();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else delete document.fonts;
});

function fontEvents({ status = 'loaded', ready } = {}) {
  const handlers = new Map();
  Object.defineProperty(document, 'fonts', { configurable: true, value: {
    status, ready,
    addEventListener: vi.fn((name, callback) => handlers.set(name, callback)),
    removeEventListener: vi.fn((name) => handlers.delete(name)),
  } });
  return (name, faces) => act(() => handlers.get(name)?.({ fontfaces: faces }));
}

it('preserves map geometry when editor italics or prose fonts load', () => {
  const emit = fontEvents();
  const { result } = renderHook(useMapFontMetrics);
  emit('loadingdone', [{ family: 'Source Sans 3 Variable', style: 'italic' }]);
  emit('loadingdone', [{ family: 'Source Serif 4 Variable', style: 'normal' }]);
  expect(result.current).toBe(0);
});

it('remeasures when the canvas font loads or fails to load', () => {
  const emit = fontEvents();
  const { result } = renderHook(useMapFontMetrics);
  emit('loadingdone', [
    { family: 'Source Sans 3 Variable', style: 'italic' },
    { family: '"Source Sans 3 Variable"', style: 'normal' },
  ]);
  expect(result.current).toBe(1);
  emit('loadingerror', [{ family: 'Source Sans 3', style: 'normal' }]);
  expect(result.current).toBe(2);
});

it('retains initial font readiness handling', async () => {
  let finishLoading;
  fontEvents({ status: 'loading', ready: new Promise(resolve => { finishLoading = resolve; }) });
  const { result, unmount } = renderHook(useMapFontMetrics);
  await act(async () => { finishLoading(); });
  expect(result.current).toBe(1);
  unmount();
});
