import React, { useEffect, useRef, useState } from 'react';

export const MAP_TOOLS_WIDTH_KEY = 'systems-mapping.map-tools-width';
export const DEFAULT_MAP_TOOLS_WIDTH = 280;

export function mapToolsBounds(available) {
  // Small screens keep the existing compact panel; desktop leaves at least 320px beside it.
  if (available <= 600) {
    const width = Math.max(0, Math.min(DEFAULT_MAP_TOOLS_WIDTH, available - 24));
    return { min: width, max: width };
  }
  return { min: 240, max: Math.min(480, Math.floor(available - 320)) };
}

export function useMapToolsSize() {
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(MAP_TOOLS_WIDTH_KEY));
      return saved >= 240 && saved <= 480 ? saved : DEFAULT_MAP_TOOLS_WIDTH;
    } catch { return DEFAULT_MAP_TOOLS_WIDTH; }
  });
  const [available, setAvailable] = useState(() => window.innerWidth);
  useEffect(() => {
    const measure = () => setAvailable(window.innerWidth);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const { min, max } = mapToolsBounds(available);
  const clamp = value => Math.round(Math.max(min, Math.min(max, value)));
  const width = clamp(preferred);
  const resize = (next, persist = false) => {
    const value = clamp(next);
    setPreferred(value);
    if (persist) {
      try { localStorage.setItem(MAP_TOOLS_WIDTH_KEY, String(value)); } catch { /* Resizing remains available without storage. */ }
    }
  };
  return { width, min, max, resize };
}

export function MapToolsResizeHandle({ panelId, width, min, max, resize }) {
  const drag = useRef(null);
  const finish = (event, cancel = false) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const start = drag.current;
    drag.current = null;
    resize(cancel ? start.width : start.width + start.x - event.clientX, !cancel);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="map-tools-resizer" role="separator" tabIndex="0" aria-label="Resize map tools" aria-orientation="vertical" aria-controls={panelId}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} pixels wide`}
    title="Drag to resize. Left and right arrows adjust width; Home resets it."
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag.current && drag.current.id === event.pointerId) resize(drag.current.width + drag.current.x - event.clientX);
    }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={() => { if (drag.current) { resize(drag.current.width); drag.current = null; } }}
    onDoubleClick={() => resize(DEFAULT_MAP_TOOLS_WIDTH, true)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      if (event.key === 'Escape' && !drag.current) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') {
        if (drag.current) {
          const start = drag.current;
          drag.current = null; resize(start.width);
          if (event.currentTarget.hasPointerCapture?.(start.id)) event.currentTarget.releasePointerCapture(start.id);
        }
        return;
      }
      resize(event.key === 'Home' ? DEFAULT_MAP_TOOLS_WIDTH : event.key === 'End' ? max
        : width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 48 : 16), true);
    }}><span aria-hidden="true" /></div>;
}
