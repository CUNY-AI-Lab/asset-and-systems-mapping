import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProjectFooter, { GUIDE_URL } from './ProjectFooter.jsx';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it('links the account workspace to its guide on the Lab website in a new tab', () => {
  vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'true');
  render(<ProjectFooter />);
  const guide = screen.getByRole('link', { name: 'Guide (opens in a new tab)' });
  expect(GUIDE_URL).toBe('https://ailab.gc.cuny.edu/docs/systems-mapping/');
  expect(guide).toHaveAttribute('href', GUIDE_URL);
  expect(guide).toHaveAttribute('target', '_blank');
  expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('contentinfo', { name: 'Project credits' })).toContainElement(guide);
});

it('leaves the guide link out of the separate Node interface', () => {
  vi.stubEnv('VITE_ACCOUNT_WORKSPACE', 'false');
  render(<ProjectFooter />);
  expect(screen.queryByRole('link', { name: /Guide/ })).not.toBeInTheDocument();
});
