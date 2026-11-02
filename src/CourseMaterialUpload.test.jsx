import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CourseMaterialUpload from './CourseMaterialUpload.jsx';
import { readMemoFile } from './documentImport.js';
vi.mock('./documentImport.js', () => ({ readMemoFile: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const file = () => new File(['A benign course passage.'], 'reading.txt', { type: 'text/plain' });
function Harness() {
  const [value, setValue] = useState('Existing material');
  return <><label>Material<textarea value={value} onChange={e => setValue(e.target.value)} /></label><CourseMaterialUpload value={value} onChange={setValue} /></>;
}
const upload = () => fireEvent.change(screen.getByLabelText('Upload course material'), { target: { files: [file()] } });
describe('course material import', () => {
  it('previews text and preserves existing material until explicit append or replacement', async () => {
    readMemoFile.mockResolvedValue({ text: 'New passage', notice: 'Text imported.' });
    render(<Harness />); upload();
    await screen.findByRole('region', { name: 'Course material import preview' });
    expect(screen.getByLabelText('Material')).toHaveValue('Existing material');
    fireEvent.click(screen.getByText('Cancel import'));
    expect(screen.getByLabelText('Material')).toHaveValue('Existing material');
    upload(); await screen.findByText('Append to course material');
    fireEvent.click(screen.getByText('Append to course material'));
    expect(screen.getByLabelText('Material')).toHaveValue('Existing material\n\nNew passage');
    upload(); await screen.findByText('Replace course material');
    fireEvent.click(screen.getByText('Replace course material'));
    expect(screen.getByLabelText('Material')).toHaveValue('New passage');
  });
  it('rejects a late file result after typing', async () => {
    let resolve; readMemoFile.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<Harness />); upload();
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'Newer typing' } });
    resolve({ text: 'Old file', notice: '' });
    expect(await screen.findByRole('alert')).toHaveTextContent('changed while reading');
    expect(screen.getByLabelText('Material')).toHaveValue('Newer typing');
  });
  it('preserves newer edits while an import preview is open', async () => {
    readMemoFile.mockResolvedValue({ text: 'New passage', notice: '' });
    render(<Harness />); upload(); await screen.findByText('Replace course material');
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'Newer typing' } });
    fireEvent.click(screen.getByText('Replace course material'));
    expect(screen.getByRole('alert')).toHaveTextContent('changed');
    expect(screen.getByLabelText('Material')).toHaveValue('Newer typing');
  });
  it.each(['Unreadable document', 'The extracted PDF text is too large.'])('keeps material on read error: %s', async message => {
    readMemoFile.mockRejectedValue(new Error(message));
    render(<Harness />); upload(); await screen.findByRole('alert');
    expect(screen.getByLabelText('Material')).toHaveValue('Existing material');
    expect(screen.queryByRole('region', { name: 'Course material import preview' })).not.toBeInTheDocument();
  });
  it('prevents an appended passage exceeding the stored text limit', async () => {
    readMemoFile.mockResolvedValue({ text: 'x'.repeat(4000), notice: '' });
    render(<Harness />); upload(); await screen.findByText('Append to course material');
    fireEvent.click(screen.getByText('Append to course material'));
    expect(screen.getByRole('alert')).toHaveTextContent('4,000');
    expect(screen.getByLabelText('Material')).toHaveValue('Existing material');
  });
  it('ignores a completion after leaving its course section', async () => {
    let resolve; readMemoFile.mockReturnValue(new Promise(r => { resolve = r; }));
    const onChange = vi.fn(); const { unmount } = render(<CourseMaterialUpload value="" onChange={onChange} />);
    upload(); unmount(); resolve({ text: 'Old section material', notice: '' });
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });
});
