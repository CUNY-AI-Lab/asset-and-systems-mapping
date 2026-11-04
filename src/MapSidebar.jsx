import React, { useEffect, useRef, useState } from 'react';

const WIDTH_KEY = 'systems-mapping.sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH = 304;

export function sidebarBounds(available) {
  const max = Math.max(200, Math.min(520, available <= 600 ? available - 48 : available - 320));
  return { min: Math.min(260, max), max: Math.floor(max) };
}

export function useSidebarSize(layoutRef) {
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved >= 200 && saved <= 520 ? saved : DEFAULT_SIDEBAR_WIDTH;
    } catch { return DEFAULT_SIDEBAR_WIDTH; }
  });
  const [available, setAvailable] = useState(() => window.innerWidth);
  useEffect(() => {
    const element = layoutRef.current;
    const measure = () => setAvailable(element?.getBoundingClientRect().width || window.innerWidth);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (element) observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [layoutRef]);
  const { min, max } = sidebarBounds(available);
  const width = Math.round(Math.max(min, Math.min(max, preferred)));
  const resize = (next, persist = false) => {
    const value = Math.round(Math.max(min, Math.min(max, next)));
    setPreferred(value);
    if (persist) {
      try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* Layout remains usable without storage. */ }
    }
  };
  return { width, min, max, resize };
}

export function SidebarResizeHandle({ width, min, max, resize }) {
  const drag = useRef(null);
  const finish = (event, cancel = false) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const start = drag.current;
    drag.current = null;
    resize(cancel ? start.width : start.width + start.x - event.clientX, !cancel);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="sidebar-resizer" role="separator" tabIndex="0" aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="map-inspector" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} pixels wide`} title="Drag to resize. Left and right arrows adjust width; Home resets it."
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus();
      drag.current = { id: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (drag.current?.id !== event.pointerId) return;
      resize(drag.current.width + drag.current.x - event.clientX);
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
    onLostPointerCapture={() => { if (drag.current) { resize(drag.current.width); drag.current = null; } }}
    onDoubleClick={() => resize(DEFAULT_SIDEBAR_WIDTH, true)}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { if (drag.current) { resize(drag.current.width); drag.current = null; } return; }
      resize(event.key === 'Home' ? DEFAULT_SIDEBAR_WIDTH : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 48 : 16), true);
    }}><span aria-hidden="true" /></div>;
}
