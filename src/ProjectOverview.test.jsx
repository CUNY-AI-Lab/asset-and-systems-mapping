import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProjectOverview from './ProjectOverview.jsx';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

afterEach(cleanup);

describe('concise cumulative map', () => {
  it('shows results without repeated instructions or empty review counters', () => {
    render(<ProjectOverview project={buildEastHarlemDisabilityProject()} />);
    fireEvent.click(screen.getByText('Cumulative map'));
    expect(screen.getByText('6 elements')).toBeVisible();
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
  it('counts Meso arrows while retaining separately labeled legacy linkages', () => {
    const project = buildEastHarlemDisabilityProject();
    project.graph.edges.filter(edge => edge.scale === 'micro').forEach(edge => { edge.scale = 'meso'; });
    const expectedCount = project.graph.edges.filter(edge => edge.scale === 'meso').length;
    render(<ProjectOverview project={project} />);
    fireEvent.click(screen.getByText('Cumulative map'));
    const meso = screen.getByRole('region', { name: 'Meso-level results' });
    expect(within(meso).getByText(`${expectedCount} relationships · 1 saved linkage`)).toBeVisible();
    expect(within(meso).queryByText(/setting links/)).not.toBeInTheDocument();
  });
  it('counts Macro relationships separately from historical scope memberships', () => {
    const project = buildEastHarlemDisabilityProject();
    const macro = project.graph.nodes.find(node => node.scale === 'macrosphere');
    const target = project.graph.nodes.find(node => node.scale === 'micro');
    project.graph.edges.push({ id: 'macro-link', source: macro.id, target: target.id, scale: 'macrosphere', verb: '', status: 'accepted', claimState: 'student interpretation', evidence: 'Synthetic source' });
    render(<ProjectOverview project={project} />);
    fireEvent.click(screen.getByText('Cumulative map'));
    expect(within(screen.getByRole('region', { name: 'Macro-level results' })).getByText(`1 node · 1 relationship · ${macro.scopeNodeIds.length} stored scope memberships`)).toBeVisible();
  });
});
