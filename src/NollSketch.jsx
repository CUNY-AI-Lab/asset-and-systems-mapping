import React, { useCallback, useEffect, useRef } from 'react';

// Gaussian Quadratic, after A. Michael Noll (Bell Labs, 1965): a parabola whose points are
// pushed about by Gaussian noise, joined in order, with a few random cross-connections.
// Noll plotted thin black lines on paper; here the lines take the page's ink colour and the
// canvas stays transparent, so the drawing sits directly on the page background.

export const NOLL_INTERVAL_MS = 10_000;

function gaussian(mean, deviation, random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function drawNoll(ctx, width, height, ink, random = Math.random) {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  // Noll scaled to the shorter side; a wide, shallow stage lets the curve use more of its width.
  const scale = Math.min(width * 0.4, height * 0.60);
  const count = 80 + Math.floor(random() * 40);
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index / count) * 2 - 1;
    const x = t + gaussian(0, 0.12, random);
    const y = t * t + gaussian(0, 0.08, random);
    points.push({ x: cx + x * scale, y: cy - y * scale + scale * 0.3 });
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  for (let index = 1; index < points.length; index += 1) {
    ctx.beginPath();
    ctx.moveTo(points[index - 1].x, points[index - 1].y);
    ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 0.5;
  for (let index = 0; index < count * 0.4; index += 1) {
    const a = Math.floor(random() * points.length);
    const b = Math.floor(random() * points.length);
    if (Math.abs(a - b) < 3 || Math.abs(a - b) > count * 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(points[a].x, points[a].y);
    ctx.lineTo(points[b].x, points[b].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return points.length;
}

export default function NollSketch({ className = '', intervalMs = NOLL_INTERVAL_MS, label = 'Drawing after A. Michael Noll, 1965. Activate for a new drawing.' }) {
  const canvasRef = useRef(null);
  const timerRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ink = window.getComputedStyle(canvas).color || 'currentColor';
    drawNoll(ctx, width, height, ink);
  }, []);

  // A fresh drawing every interval; a click or tap draws at once and restarts the clock.
  const schedule = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') draw();
      schedule();
    }, intervalMs);
  }, [draw, intervalMs]);

  const regenerate = useCallback(() => {
    draw();
    schedule();
  }, [draw, schedule]);

  useEffect(() => {
    draw();
    schedule();
    const canvas = canvasRef.current;
    const resizeObserver = typeof ResizeObserver === 'function' && canvas ? new ResizeObserver(() => draw()) : null;
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener('resize', draw);
    // The lines take the page ink, so a theme change redraws them in the new colour.
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => draw())
      : null;
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      window.clearTimeout(timerRef.current);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [draw, schedule]);

  return <div className={`noll-sketch ${className}`.trim()}>
    <button type="button" className="noll-sketch__surface" onClick={regenerate} aria-label={label}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
    <p className="noll-sketch__credit" aria-hidden="true">After A. Michael Noll, 1965</p>
  </div>;
}
