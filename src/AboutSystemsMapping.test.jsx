import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AboutSystemsMapping, { ABOUT_FLAG_DURATION, ABOUT_SYSTEMS_MAPPING } from './AboutSystemsMapping.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = duration => act(() => vi.advanceTimersByTime(duration));
const openFlag = () => {
  fireEvent.click(screen.getByRole('button', { name:'About Systems Mapping' }));
  return screen.getByRole('region', { name:'About Systems Mapping' });
};

it('shows the exact description and two practical sentences without moving focus', () => {
  render(<AboutSystemsMapping />);
  const trigger = screen.getByRole('button', { name:'About Systems Mapping' });
  trigger.focus();
  const flag = openFlag();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded','true');
  expect([...flag.querySelectorAll('p')].map(p => p.textContent)).toEqual(ABOUT_SYSTEMS_MAPPING);
  expect(ABOUT_SYSTEMS_MAPPING).toEqual([
    'Systems mapping helps students visualize memos as network graphs scaffolded across local and global scales, using ecological systems theory to connect nodes across people and places, laws and policies, along with broader historical and sociological influences.',
    'Upload your first memo to place people, places, and resources on the map, then use Notebook to create and label their relationships.',
    'Add your second memo to extend the map to institutions and broader conditions; edit either memo in Memo and choose Update map to incorporate your changes.',
  ]);
  expect(within(flag).queryByRole('dialog')).not.toBeInTheDocument();
});

it('dismisses after twelve seconds and can always reopen with a fresh interval', () => {
  render(<AboutSystemsMapping />);
  openFlag(); advance(ABOUT_FLAG_DURATION - 1);
  expect(screen.getByRole('region')).toBeInTheDocument();
  advance(1); expect(screen.queryByRole('region')).not.toBeInTheDocument();
  openFlag(); advance(ABOUT_FLAG_DURATION - 1);
  expect(screen.getByRole('region')).toBeInTheDocument();
  advance(1); expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('pauses the remaining interval while hovered instead of expiring under the reader', () => {
  render(<AboutSystemsMapping />);
  const flag = openFlag(); advance(5_000); fireEvent.pointerEnter(flag); advance(30_000);
  expect(flag).toBeInTheDocument();
  fireEvent.pointerLeave(flag); advance(6_999); expect(flag).toBeInTheDocument();
  advance(1); expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('pauses while focus is inside and resumes only when both focus and hover leave', () => {
  render(<><AboutSystemsMapping /><button>Outside</button></>);
  const flag = openFlag(); advance(4_000);
  act(() => flag.focus()); fireEvent.pointerEnter(flag); advance(20_000);
  fireEvent.pointerLeave(flag); advance(20_000); expect(flag).toBeInTheDocument();
  act(() => screen.getByRole('button', { name:'Outside' }).focus());
  advance(7_999); expect(flag).toBeInTheDocument();
  advance(1); expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('dismisses on Escape and returns focus only when it was inside the flag', () => {
  render(<AboutSystemsMapping />);
  const flag = openFlag(); act(() => flag.focus());
  fireEvent.keyDown(flag, { key:'Escape' });
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name:'About Systems Mapping' })).toHaveFocus();
});

it('dismisses on outside interaction without stealing focus or blocking the action', () => {
  const onClick = vi.fn();
  render(<><AboutSystemsMapping /><button onClick={onClick}>Outside</button></>);
  const flag = openFlag(); fireEvent.pointerDown(flag); expect(flag).toBeInTheDocument();
  const outside = screen.getByRole('button', { name:'Outside' });
  outside.focus(); fireEvent.pointerDown(outside); fireEvent.click(outside);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(outside).toHaveFocus(); expect(onClick).toHaveBeenCalledOnce();
});

it('cancels the interval and listeners when unmounted', () => {
  const { unmount } = render(<AboutSystemsMapping />);
  openFlag(); expect(vi.getTimerCount()).toBe(1);
  unmount(); expect(vi.getTimerCount()).toBe(0);
  fireEvent.keyDown(document, { key:'Escape' });
});
