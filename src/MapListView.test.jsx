import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapListView, { mapItemEvidenceStatus } from './MapListView.jsx';

const nodes = [
  { id: 'home', label: 'Rosa’s home', type: 'setting', scale: 'micro', status: 'confirmed', claimState: 'confirmed', evidence: 'The memo describes the home.' },
  { id: 'group', label: 'Peer support group', type: 'setting', scale: 'micro', status: 'confirmed', claimState: 'confirmed', evidence: 'The memo names the weekly group.' },
  { id: 'coordination', label: 'Home and peer-group coordination', type: 'mesosystem', scale: 'meso', status: 'confirmed', claimState: 'confirmed', scopeNodeIds: ['home', 'group'], evidence: 'The memo documents calls between settings.' },
  { id: 'agency', label: 'Access-A-Ride scheduling office', type: 'agency', scale: 'exosphere', status: 'confirmed', claimState: 'confirmed', evidence: '' },
  { id: 'policy', label: 'State home-care reimbursement policy', type: 'policy', scale: 'macrosphere', status: 'research lead', claimState: 'research lead', scopeNodeIds: ['home', 'agency'], evidence: '' },
  { id: 'removed', label: 'Earlier draft node', type: 'person', scale: 'micro', status: 'rejected', claimState: 'retired', evidence: '' },
];

const edges = [
  { id: 'support', source: 'group', target: 'home', verb: 'supports', scale: 'meso', status: 'confirmed', claimState: 'confirmed', evidenceExcerpt: 'The group supports Rosa at home.' },
  { id: 'schedule', source: 'agency', target: 'home', verb: 'sets rules for', scale: 'exosphere', status: 'pending', claimState: 'inference', evidence: '' },
  { id: 'removed-edge', source: 'home', target: 'group', verb: 'used to call', scale: 'meso', status: 'rejected', claimState: 'retired', evidence: '' },
];

afterEach(cleanup);

describe('MapListView', () => {
  it('shows the selected Meso level with the scoped Micro settings and exact level titles', () => {
    render(<MapListView nodes={nodes} edges={edges} visibleScale="meso" />);

    expect(screen.getByRole('heading', { name: 'Meso-level' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Micro-level' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Exo-level' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Macro-level' })).not.toBeInTheDocument();

    const linkage = screen.getByRole('button', { name: 'Open details for Home and peer-group coordination' });
    expect(within(linkage).getByText('Rosa’s home, Peer support group')).toBeVisible();
    expect(within(linkage).getByText('Mesosystem')).toBeVisible();
    expect(within(linkage).getByText('Evidence added')).toBeVisible();
  });

  it('names affected map items for a Macro item and opens the matching node', () => {
    const onSelect = vi.fn();
    render(<MapListView nodes={nodes} edges={edges} visibleScale="macrosphere" onSelect={onSelect} />);

    const structure = screen.getByRole('button', { name: 'Open details for State home-care reimbursement policy' });
    expect(within(structure).getByText('Affected map items')).toBeVisible();
    expect(within(structure).getByText('Rosa’s home, Access-A-Ride scheduling office')).toBeVisible();
    expect(within(structure).getByText('Macro-level')).toBeVisible();
    expect(within(structure).getByText('Needs evidence')).toBeVisible();

    fireEvent.click(structure);
    expect(onSelect).toHaveBeenCalledWith('node', 'policy', true);
  });

  it('renders connection propositions with readable metadata and opens the matching edge', () => {
    const onSelect = vi.fn();
    render(<MapListView nodes={nodes} edges={edges} visibleScale="meso" onSelect={onSelect} />);

    const connection = screen.getByRole('button', { name: 'Open details for Peer support group supports Rosa’s home' });
    expect(within(connection).getByText('Peer support group')).toBeVisible();
    expect(within(connection).getByText('supports →')).toBeVisible();
    expect(within(connection).getByText('Rosa’s home')).toBeVisible();
    expect(within(connection).getByText('Connection')).toBeVisible();
    expect(within(connection).getByText('Evidence added')).toBeVisible();

    fireEvent.click(connection);
    expect(onSelect).toHaveBeenCalledWith('edge', 'support', true);
  });

  it('shows additive evidence, Micro participation, setting membership, Meso explanation, and process details in the readable list', () => {
    const enrichedNodes = structuredClone(nodes);
    const home = enrichedNodes.find((node) => node.id === 'home');
    home.claimEvidence = [{
      id: 'claim-home-1',
      sourcePassage: 'The memo describes support in the home.',
      studentInterpretation: 'The home is an immediate setting.',
      warrant: '', uncertainty: '', counterevidence: '', missingVoice: '',
    }];
    home.focalParticipation = 'direct';
    home.settingNodeIds = ['group'];
    enrichedNodes.find((node) => node.id === 'coordination').mesoExplanation = 'Information moves between the home and peer-support settings.';
    const enrichedEdges = structuredClone(edges);
    const support = enrichedEdges.find((edge) => edge.id === 'support');
    support.claimEvidence = [{
      id: 'claim-support-1',
      sourcePassage: 'The memo names this support.',
      studentInterpretation: '', warrant: '', uncertainty: '', counterevidence: '', missingVoice: '',
    }];
    support.relationshipProcess = {
      frequency: 'weekly',
      duration: 'six months',
      direction: 'both directions',
      conditions: '',
      changeOverTime: '',
    };

    render(<MapListView nodes={enrichedNodes} edges={enrichedEdges} visibleScale="all" />);

    const homeRecord = screen.getByRole('button', { name: 'Open details for Rosa’s home' });
    expect(within(homeRecord).getByText('Evidence records')).toBeVisible();
    expect(within(homeRecord).getByText('Direct participation')).toBeVisible();
    expect(within(homeRecord).getByText('Direct')).toBeVisible();
    expect(within(homeRecord).getByText('Micro settings')).toBeVisible();
    expect(within(homeRecord).getByText('Peer support group')).toBeVisible();

    const mesoRecord = screen.getByRole('button', { name: 'Open details for Home and peer-group coordination' });
    expect(within(mesoRecord).getByText('How settings interact')).toBeVisible();
    expect(within(mesoRecord).getByText('Information moves between the home and peer-support settings.')).toBeVisible();

    const connection = screen.getByRole('button', { name: 'Open details for Peer support group supports Rosa’s home, both directions' });
    expect(within(connection).getByText('Evidence records')).toBeVisible();
    expect(within(connection).getByText('Process and time')).toBeVisible();
    expect(within(connection).getByText('Frequency: weekly; Duration: six months; Direction: both directions')).toBeVisible();
  });

  it('keeps removed records out of the list unless the student asks to see them', () => {
    const { rerender } = render(<MapListView nodes={nodes} edges={edges} visibleScale="meso" />);
    expect(screen.queryByRole('button', { name: 'Open details for Earlier draft node' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open details for Rosa’s home used to call Peer support group' })).not.toBeInTheDocument();

    rerender(<MapListView nodes={nodes} edges={edges} visibleScale="meso" showRemoved />);
    expect(screen.getByRole('button', { name: 'Open details for Earlier draft node' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open details for Rosa’s home used to call Peer support group' })).toBeVisible();
    expect(screen.getAllByText('Removed').length).toBeGreaterThanOrEqual(2);
  });

  it('shows Micro items without relationship records, and carries unconnected Micro items into Meso', () => {
    const extra = { id: 'person', label: 'Assistant principal', type: 'person', scale: 'micro', status: 'confirmed' };
    const { rerender } = render(<MapListView nodes={[...nodes, extra]} edges={edges} visibleScale="micro" />);
    expect(screen.queryByRole('button', { name: /supports Rosa/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open details for Assistant principal' })).toBeVisible();
    rerender(<MapListView nodes={[...nodes, extra]} edges={edges} visibleScale="meso" />);
    expect(screen.getByRole('button', { name: /supports Rosa/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open details for Assistant principal' })).toBeVisible();
  });
  it('states when no records are visible and distinguishes evidence states', () => {
    render(<MapListView nodes={[]} edges={[]} visibleScale="exosphere" />);
    expect(screen.getByText('No map items are visible at this level.')).toBeVisible();
    expect(screen.getByLabelText('0 visible map items')).toHaveTextContent('0 shown');

    expect(mapItemEvidenceStatus({ claimState: 'contested' })).toBe('Evidence contested');
    expect(mapItemEvidenceStatus({ status: 'pending', claimState: 'inference' })).toBe('Evidence to review');
    expect(mapItemEvidenceStatus({ status: 'confirmed', claimState: 'confirmed' })).toBe('No evidence added');
  });
});
