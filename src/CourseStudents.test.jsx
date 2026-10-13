import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CourseStudents from './CourseStudents.jsx';
import { apiRequest, ApiError } from './api.js';

vi.mock('./api.js', async original => ({ ...await original(), apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
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
