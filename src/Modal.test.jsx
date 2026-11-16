import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './App.jsx';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dialog focus during edits', () => {
  it('keeps the input and caret focused through each controlled edit', () => {
    vi.useFakeTimers();
    function Details() {
      const [title, setTitle] = useState('');
      return <Modal open title="Project details" onClose={() => {}}>
        <label>Project<input value={title} onChange={event => setTitle(event.target.value)} /></label>
      </Modal>;
    }
    render(<Details />);
    act(() => vi.runAllTimers());
    expect(screen.getByRole('button', { name: 'Close Project details' })).toHaveFocus();
    const input = screen.getByRole('textbox', { name: 'Project' });
    input.focus();
    for (const text of ['C', 'CU', 'CUN', 'CUNY', 'CUNY AI Lab']) {
      fireEvent.change(input, { target: { value: text } });
      act(() => vi.runAllTimers());
      expect(input).toHaveValue(text);
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(text.length);
    }
  });

  it('uses the current close handler without restarting focus and restores the opener only on close', () => {
    vi.useFakeTimers();
    const earlier = vi.fn(), current = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Project'; document.body.append(opener); opener.focus();
    const view = render(<Modal open title="Details" onClose={earlier}><input aria-label="Title" /></Modal>);
    act(() => vi.runAllTimers());
    const input = screen.getByRole('textbox', { name: 'Title' }); input.focus();
    view.rerender(<Modal open title="Details" onClose={current}><input aria-label="Title" /></Modal>);
    act(() => vi.runAllTimers());
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(current).toHaveBeenCalledTimes(1);
    expect(earlier).not.toHaveBeenCalled();
    view.rerender(<Modal open={false} title="Details" onClose={current} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('cancels delayed opening focus when a dialog closes immediately', () => {
    vi.useFakeTimers();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const view = render(<Modal open title="Details" onClose={() => {}} />);
    view.rerender(<Modal open={false} title="Details" onClose={() => {}} />);
    act(() => vi.runAllTimers());
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it.each([false, true])('keeps keyboard navigation inside the dialog when focus starts outside (shift=%s)', shiftKey => {
    vi.useFakeTimers();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    render(<Modal open title="Details" onClose={() => {}}><input aria-label="Title" /></Modal>);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    opener.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shiftKey ? screen.getByRole('textbox', { name: 'Title' }) : screen.getByRole('button', { name: 'Close Details' })).toHaveFocus();
    opener.remove();
  });
});
