import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GuidanceProgress, { approximateProgress, phaseFor } from './GuidanceProgress.jsx';

describe('GuidanceProgress', () => {
  it('moves through short phase words and never completes on its own', () => {
    expect(phaseFor(0)).toBe('Saving');
    expect(phaseFor(5)).toBe('Reading memo');
    expect(phaseFor(20)).toBe('Checking quotes');
    expect(phaseFor(40)).toBe('Rechecking');
    expect(phaseFor(90)).toBe('Still working');
    expect(phaseFor(4, 'Temporary model interruption. Retrying after the requested delay (attempt 2 of 3)…')).toBe('Rechecking');
    expect(approximateProgress(0)).toBe(0);
    expect(approximateProgress(18)).toBeGreaterThan(50);
    expect(approximateProgress(600)).toBe(95);
  });

  it('renders an accessible figure with the detailed status available to assistive technology', () => {
    render(<GuidanceProgress active message="Reading memo (attempt 1 of 3)" />);
    const bar = screen.getByRole('progressbar', { name: 'Guidance progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('status')).toHaveTextContent('Reading memo (attempt 1 of 3)');
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Saving');
  });

  it('renders nothing when idle', () => {
    const { container } = render(<GuidanceProgress active={false} message="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
