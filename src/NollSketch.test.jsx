import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NollSketch, { drawNoll } from './NollSketch.jsx';

function recordingContext() {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    clearRect: record('clearRect'), setTransform: record('setTransform'), beginPath: record('beginPath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), stroke: record('stroke'), strokeRect: record('strokeRect'),
    fillRect: record('fillRect'),
  };
}

describe('NollSketch', () => {
  let context;
  beforeEach(() => {
    context = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 });
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const drawings = () => context.calls.filter(([name]) => name === 'clearRect').length;

  it('draws on mount, again on click, and again every ten seconds', () => {
    render(<NollSketch />);
    expect(drawings()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /after A\. Michael Noll/ }));
    expect(drawings()).toBe(2);
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(drawings()).toBe(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(drawings()).toBe(3);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(drawings()).toBe(4);
  });

  it('stops drawing after unmount', () => {
    const { unmount } = render(<NollSketch />);
    unmount();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(drawings()).toBe(1);
  });

  it('uses the current theme ink even when an inherited control color is still transitioning', async () => {
    let ink = '#121a2b';
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      color: 'rgb(18, 26, 43)',
      getPropertyValue: name => name === '--ink' ? ink : '',
    }));
    render(<NollSketch />);
    expect(context.strokeStyle).toBe('#121a2b');
    ink = '#f1f1f1';
    await act(async () => { document.documentElement.dataset.theme = 'dark'; });
    expect(context.strokeStyle).toBe('#f1f1f1');
    delete document.documentElement.dataset.theme;
  });

  it('leaves the background transparent and draws no frame', () => {
    const ctx = recordingContext();
    let seed = 0.5;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const count = drawNoll(ctx, 640, 360, 'rgb(18, 26, 43)', random);
    expect(count).toBeGreaterThanOrEqual(80);
    expect(ctx.calls.some(([name]) => name === 'fillRect' || name === 'strokeRect')).toBe(false);
    expect(ctx.calls.filter(([name]) => name === 'stroke').length).toBeGreaterThan(count - 2);
    expect(ctx.strokeStyle).toBe('rgb(18, 26, 43)');
    expect(ctx.globalAlpha).toBe(1);
  });
});
