import { useEffect, useMemo, useState } from 'react';

// Use the visible canvas, not a tall fixed phone coordinate window.
// Geometry changes trigger fitting; edits and pointer gestures do not.
export function useCanvasWindow(ref, enabled, width = 840, centerY = 270) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    if (!enabled || !ref.current) return undefined;
    const element = ref.current;
    const measure = () => {
      const rect = (element.querySelector('.graph-canvas') || element).getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(current => current?.width === next.width && current?.height === next.height ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [enabled, ref]);
  return useMemo(() => {
    const height = size ? width * size.height / size.width : 1400;
    return { x: 0, y: centerY - height / 2, width, height };
  }, [size, width, centerY]);
}
