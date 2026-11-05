import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NodeClassificationEditor from './NodeClassificationEditor.jsx';

afterEach(cleanup);
const node = { id: 'node_role', scale: 'exosphere', type: 'resource' };

it('shows named System and Type fields and offers Save only for a changed selection', () => {
  const onSave = vi.fn();
  const { rerender } = render(<NodeClassificationEditor node={node} onSave={onSave} />);
  expect(screen.getByRole('combobox', { name: 'System' })).toHaveValue('exosphere');
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('resource');
  expect(screen.queryByRole('button', { name: 'Save classification' })).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Node classification' }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'System' }), { target: { value: 'micro' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'role' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save classification' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('micro', 'role');
  rerender(<NodeClassificationEditor node={{ ...node, scale: 'micro', type: 'role' }} onSave={onSave} />);
  expect(screen.queryByRole('button', { name: 'Save classification' })).not.toBeInTheDocument();
});

it('keeps a rejected draft visible and Cancel restores the saved classification', () => {
  const onSave = vi.fn(() => 'Update the saved connection first.');
  render(<NodeClassificationEditor node={node} onSave={onSave} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'System' }), { target: { value: 'macrosphere' } });
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('policy');
  expect(screen.queryByRole('option', { name: 'Resource' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save classification' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Update the saved connection first.');
  expect(screen.getByRole('combobox', { name: 'System' })).toHaveValue('macrosphere');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('combobox', { name: 'System' })).toHaveValue('exosphere');
  expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('resource');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save classification' })).not.toBeInTheDocument();
  expect(onSave).toHaveBeenCalledOnce();
});
