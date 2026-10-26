import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MapTextEditor from './MapTextEditor.jsx';

afterEach(cleanup);
const validate = value => value ? '' : 'Enter a label.';

it('saves only explicitly, cancels without blur commits, and keeps invalid drafts local', () => {
  const save = vi.fn();
  render(<MapTextEditor label="Label" value="Resident" maxLength={200} validate={validate} onSave={save} />);
  const field = screen.getByRole('textbox', { name: 'Label' });
  fireEvent.change(field, { target: { value: 'Draft' } });
  fireEvent.blur(field);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(field).toHaveValue('Resident');
  fireEvent.change(field, { target: { value: 'Discard this' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  fireEvent.blur(field);
  expect(field).toHaveValue('Resident');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a label.');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '  Neighborhood resident  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledExactlyOnceWith('Neighborhood resident');
});

it('discards drafts on selection change and offers only scale vocabulary choices', () => {
  const save = vi.fn();
  const { rerender } = render(<MapTextEditor key="node-one" label="Label" value="Resident" validate={validate} onSave={save} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved draft' } });
  rerender(<MapTextEditor key="edge-two" label="Relationship" value="funds" options={['funds', 'regulates']} validate={validate} onSave={save} />);
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Relationship' })).toHaveValue('funds');
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});
