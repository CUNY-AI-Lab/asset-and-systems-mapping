import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CourseStudents from './CourseStudents.jsx';
import { apiRequest, ApiError } from './api.js';

vi.mock('./api.js', async original => ({ ...await original(), apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); });
const student = { memberId: 'synthetic-student', displayName: 'Alice Student', firstSeen: '2026-10-13T20:00:00Z', projectCount: 0, projects: [] };

test('shows a verified student before a map and saved stage progress after refresh', async () => {
  apiRequest.mockResolvedValueOnce({ students: [student], nextCursor: null });
  render(<CourseStudents />);
  await screen.findByRole('heading', { name: 'Alice Student' });
  expect(screen.getByText('Signed in · First course map pending')).toBeInTheDocument();
  apiRequest.mockResolvedValueOnce({ students: [{ ...student, projectCount: 1, projects: [{ id: 'map', title: 'Classroom connections', updatedAt: '2026-10-13T20:30:00Z', revision: 2, levels: [
    { scale: 'micro', completed: true, started: true, stage: 4 },
    { scale: 'meso', completed: false, started: true, stage: 2 },
    { scale: 'exosphere', completed: false, started: false, stage: 1 },
  ] }] }], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh students' }));
  await screen.findByText('Classroom connections');
  expect(screen.getByText('Micro: Completed')).toBeInTheDocument();
  expect(screen.getByText('Meso: Choose elements')).toBeInTheDocument();
  expect(screen.getByText('Exo: Upcoming')).toBeInTheDocument();
});

test('clears previously displayed student data when fresh owner authorization fails', async () => {
  apiRequest.mockResolvedValueOnce({ students: [student], nextCursor: 'page2' });
  render(<CourseStudents />);
  await screen.findByRole('heading', { name: 'Alice Student' });
  apiRequest.mockRejectedValueOnce(new ApiError('Course access changed', 403));
  fireEvent.click(screen.getByRole('button', { name: 'More students' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: 'Alice Student' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'More students' })).toBeNull();
});


test('labels illustrative demo progress without claiming a student sign-in', async () => {
  apiRequest.mockResolvedValueOnce({ students: [{ ...student, demonstration: true, displayName: 'Example student', firstSeen: null }], nextCursor: null });
  render(<CourseStudents />);
  await screen.findByText('Demonstration data · illustrative progress and revision counts');
  expect(screen.queryByText(/First signed in/)).toBeNull();
});

test('refreshes only the visible open roster and clears a revoked roster on return', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  apiRequest.mockResolvedValue({ students: [student], nextCursor: null });
  let view;
  await act(async () => { view = render(<CourseStudents active={false} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(apiRequest).not.toHaveBeenCalled();
  await act(async () => { view.rerender(<CourseStudents active />); });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(apiRequest).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue('hidden');
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(apiRequest).toHaveBeenCalledTimes(2);
  apiRequest.mockRejectedValueOnce(new ApiError('Course access changed', 403));
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByRole('heading', { name: student.displayName })).toBeNull();
  expect(screen.getByRole('alert')).toBeVisible();
  await act(async () => { view.rerender(<CourseStudents active={false} />); });
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(30000); });
  expect(apiRequest).toHaveBeenCalledTimes(3);
});

test('does not render a late roster response after the disclosure is closed', async () => {
  let resolve;
  apiRequest.mockImplementationOnce(() => new Promise(complete => { resolve = complete; }));
  const view = render(<CourseStudents />);
  view.rerender(<CourseStudents active={false} />);
  await act(async () => { resolve({ students: [student], nextCursor: null }); });
  expect(screen.queryByRole('heading', { name: student.displayName })).toBeNull();
});
