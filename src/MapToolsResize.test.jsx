import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapToolsResizeHandle, MAP_TOOLS_WIDTH_KEY, mapToolsBounds, useMapToolsSize } from './MapToolsResize.jsx';

function Tools() {
  const size = useMapToolsSize();
  return <div id="test-map-tools"><MapToolsResizeHandle panelId="test-map-tools" {...size} /></div>;
}
beforeEach(() => { vi.stubGlobal('innerWidth', 1440); localStorage.removeItem(MAP_TOOLS_WIDTH_KEY); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.removeItem(MAP_TOOLS_WIDTH_KEY); });

it('bounds the whole panel and leaves room for the map at desktop and intermediate widths', () => {
  expect(mapToolsBounds(1440)).toEqual({ min: 240, max: 480 });
  expect(mapToolsBounds(700)).toEqual({ min: 240, max: 380 });
  expect(mapToolsBounds(390)).toEqual({ min: 280, max: 280 });
  expect(mapToolsBounds(280)).toEqual({ min: 256, max: 256 });
});

it('supports keyboard resizing, clamping, reset, and a separate persisted tools preference', () => {
  localStorage.setItem('systems-mapping.sidebar-width', '320');
  const first = render(<Tools />);
  const handle = screen.getByRole('separator', { name: 'Resize map tools' });
  expect(handle).toHaveAttribute('aria-controls', 'test-map-tools');
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
  expect(handle).toHaveAttribute('aria-valuenow', '328');
  first.unmount();
  render(<Tools />);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '328');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' });
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '480');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '280');
  expect(localStorage.getItem('systems-mapping.sidebar-width')).toBe('320');
  localStorage.removeItem('systems-mapping.sidebar-width');
});

it('temporarily clamps a desktop preference on a phone without overwriting it', () => {
  localStorage.setItem(MAP_TOOLS_WIDTH_KEY, '440');
  render(<Tools />);
  act(() => { window.innerWidth = 390; window.dispatchEvent(new Event('resize')); });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '280');
  expect(localStorage.getItem(MAP_TOOLS_WIDTH_KEY)).toBe('440');
  act(() => { window.innerWidth = 1440; window.dispatchEvent(new Event('resize')); });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '440');
});

it('restores the prior width on cancelled drag and does not persist a partial resize', () => {
  render(<Tools />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 700 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 640 });
  expect(handle).toHaveAttribute('aria-valuenow', '340');
  fireEvent.pointerCancel(handle, { pointerId: 1, clientX: 640 });
  expect(handle).toHaveAttribute('aria-valuenow', '280');
  expect(localStorage.getItem(MAP_TOOLS_WIDTH_KEY)).toBeNull();
});

it('continues resizing when preference storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  render(<Tools />);
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '264');
});
