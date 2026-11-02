import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GuidanceProgress, { approximateProgress, phaseFor } from './GuidanceProgress.jsx';

describe('GuidanceProgress', () => {
  it('uses request status rather than elapsed time to name the work', () => {
    for (const elapsed of [0, 5, 20, 40, 90, 600]) {
      expect(phaseFor(elapsed, 'Reading memo (attempt 1 of 3)')).toBe('Generating guidance');
    }
    expect(phaseFor(90, 'Saving your generation request…')).toBe('Saving request');
    expect(phaseFor(0, 'Recovering your saved request…')).toBe('Recovering request');
    expect(phaseFor(4, 'Temporary model interruption. Retrying after the requested delay (attempt 2 of 3)…')).toBe('Waiting to retry');
    expect(phaseFor(0, 'Reading memo', 'meso')).toBe('Identifying relationships');
    expect(phaseFor(90, 'Reading memo', 'micro')).toBe('Classifying nodes');
    expect(phaseFor(90, 'Saving request', 'micro')).toBe('Saving request');
    expect(approximateProgress(0)).toBe(0);
    expect(approximateProgress(18)).toBeGreaterThan(50);
    expect(approximateProgress(600)).toBe(95);
  });

  it('renders an accessible figure with the detailed status available to assistive technology', () => {
    render(<GuidanceProgress active message="Reading memo (attempt 1 of 3)" />);
    const bar = screen.getByRole('progressbar', { name: 'Guidance progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('status')).toHaveTextContent('Reading memo (attempt 1 of 3)');
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Generating guidance');
  });

  it('renders nothing when idle', () => {
    const { container } = render(<GuidanceProgress active={false} message="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

it('names Exo contextualization without overriding saving', () => { expect(phaseFor(20, '', 'exosphere')).toBe('Contextualizing scales'); expect(phaseFor(20, 'Saving', 'exosphere')).toBe('Saving request'); });

it('names the Macro relationship operation', () => expect(phaseFor(0, '', 'macrosphere')).toBe('Identifying relationships'));
