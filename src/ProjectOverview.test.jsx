import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProjectOverview from './ProjectOverview.jsx';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

afterEach(cleanup);

describe('concise cumulative map', () => {
  it('shows results without repeated instructions or empty review counters', () => {
    render(<ProjectOverview project={buildEastHarlemDisabilityProject()} />);
    fireEvent.click(screen.getByText('Cumulative map'));
    expect(screen.getByText('6 elements · 4 relationships')).toBeVisible();
    expect(screen.queryByText(/Each level builds|0 items to|drawing conclusions/)).not.toBeInTheDocument();
    expect(document.querySelector('.project-overview__review')).toBeNull();
  });
  it('keeps outstanding interpretations and deferred choices visible', () => {
    const project = buildEastHarlemDisabilityProject();
    project.graph.nodes[0].claimState = 'inference';
    project.candidates.nodes.push({ id: 'question', scale: 'micro', status: 'research lead' });
    render(<ProjectOverview project={project} />);
    fireEvent.click(screen.getByText('Cumulative map'));
    expect(screen.getByText('1 item to review · 1 item set aside')).toBeVisible();
  });
});
