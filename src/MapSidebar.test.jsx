import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SidebarResizeHandle, sidebarBounds, useSidebarSize } from './MapSidebar.jsx';

afterEach(() => { cleanup(); localStorage.removeItem('systems-mapping.sidebar-width'); });
function Sidebar() {
  const ref = useRef(null);
  const size = useSidebarSize(ref);
  return <div ref={ref}><SidebarResizeHandle {...size} /></div>;
}
it('reserves map space at desktop and narrow widths', () => {
  expect(sidebarBounds(1440)).toEqual({ min: 260, max: 360 });
  expect(sidebarBounds(320)).toEqual({ min: 260, max: 272 });
  expect(sidebarBounds(280)).toEqual({ min: 232, max: 232 });
});
it('supports keyboard sizing and restores the chosen width after remount', () => {
  const first = render(<Sidebar />);
  const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(handle).toHaveAttribute('aria-valuenow', '320');
  first.unmount();
  render(<Sidebar />);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '320');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '304');
});
it('cancels a drag without saving an accidental width', () => {
  render(<Sidebar />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 700 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 650 });
  expect(handle).toHaveAttribute('aria-valuenow', '354');
  fireEvent.pointerCancel(handle, { pointerId: 1, clientX: 650 });
  expect(handle).toHaveAttribute('aria-valuenow', '304');
  expect(localStorage.getItem('systems-mapping.sidebar-width')).toBeNull();
});
