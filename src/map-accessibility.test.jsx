import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphCanvas, MapStage } from './App.jsx';
import { createDefaultProject } from './domain.js';

function mapNode(id, label, x, y, type = 'person') {
  return {
    id,
    label,
    x,
    y,
    type,
    scale: 'micro',
    status: 'confirmed',
    claimState: 'student interpretation',
    reviewDecision: 'added',
    evidence: `${label} appears in the memo.`,
    claimEvidence: [],
    scopeNodeIds: [],
    settingNodeIds: [],
    focalParticipation: 'direct',
    notes: '',
    annotations: {
      analytical: { id: `annotation-${id}-analytical`, text: '' },
      evidence: { id: `annotation-${id}-evidence`, text: '' },
    },
  };
}

function mapEdge(source, target) {
  return {
    id: 'edge-supports',
    source: source.id,
    sourceLabel: source.label,
    target: target.id,
    targetLabel: target.label,
    verb: 'supports',
    scale: 'micro',
    status: 'confirmed',
    claimState: 'student interpretation',
    reviewDecision: 'added',
    evidence: 'The memo documents this connection.',
    claimEvidence: [],
    notes: '',
    annotation: { id: 'annotation-edge-supports', text: '' },
  };
}

function mapFixture() {
  const rosa = mapNode('node-rosa', 'Rosa', 260, 230);
  const group = mapNode('node-group', 'Peer support group', 580, 310, 'group');
  const edge = mapEdge(rosa, group);
  return { nodes: [rosa, group], edges: [edge], rosa, group, edge };
}

function projectFixture() {
  const project = createDefaultProject();
  const graph = mapFixture();
  project.title = 'Accessibility map';
  project.stage = 3;
  project.furthestStage = 3;
  project.activeScale = 'micro';
  project.releasedScales = ['micro'];
  project.graph = { nodes: graph.nodes, edges: graph.edges };
  project.events = [];
  return project;
}

function renderMapStage({ phone = false, extraProps = {} } = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: phone ? 390 : 1280 });
  window.matchMedia = vi.fn((query) => ({
    matches: phone && query.includes('max-width: 600px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const update = vi.fn();
  return { ...render(<MapStage
    project={projectFixture()}
    update={update}
    toast={vi.fn()}
    logPrototype={vi.fn()}
    saveState={{ status: 'saved', message: '', savedRevision: 1 }}
    stageAnnotationDraft={{ id: 'annotation-map', text: '' }}
    commitAnnotationDrafts={vi.fn(() => ({ changed: false }))}
    flushSave={vi.fn()}
    onRequestRestart={vi.fn()}
    {...extraProps}
  />), update };
}

describe('map accessibility', () => {
  beforeEach(() => {
    window.requestAnimationFrame = vi.fn((callback) => {
      callback(0);
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('exposes complete canvas, node, and connection names and supports keyboard activation', () => {
    const { nodes, edges, rosa, edge } = mapFixture();
    const onSelect = vi.fn();
    const onMoveNode = vi.fn();
    render(<GraphCanvas
      nodes={nodes}
      edges={edges}
      selection={null}
      onSelect={onSelect}
      onMoveNode={onMoveNode}
      viewport={{ panX: 0, panY: 0, zoom: 1 }}
      phoneLayout={false}
      mapLabel="Micro-level map"
      onViewportChange={vi.fn()}
      onAnnounce={vi.fn()}
    />);

    const canvas = screen.getByRole('group', { name: /Micro-level map.*Choose a node or connection for details/i });
    const node = screen.getByRole('button', { name: /Rosa, person, Micro-level, evidence recorded/i });
    const connection = screen.getByRole('button', { name: /Rosa supports Peer support group, direction: source to target, Micro-level connection/i });
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(node).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('ArrowRight'));
    expect(connection).toHaveAttribute('aria-keyshortcuts', 'Enter Space');

    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('node', rosa.id, true);
    connection.focus();
    fireEvent.keyDown(connection, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('edge', edge.id, true);
  });

  it.each(['micro', 'meso'])('allows %s dragging into visible space left of the old world rectangle after zooming', (scale) => {
    const { nodes } = mapFixture();
    const node = { ...nodes[0], x: 100, y: 250 };
    const onMoveNode = vi.fn();
    render(<GraphCanvas nodes={[node]} edges={[]} selection={null} onSelect={vi.fn()} onMoveNode={onMoveNode}
      viewport={{ panX: 400, panY: 0, zoom: 0.5 }} phoneLayout={false} visibleLayer={scale} mapMode="network"
      mapLabel="Synthetic map" onViewportChange={vi.fn()} onAnnounce={vi.fn()} />);
    const canvas = document.querySelector('.graph-canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 840, height: 540, right: 840, bottom: 540 });
    const target = document.querySelector('.graph-node');
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 450, clientY: 125 });
    fireEvent.pointerMove(canvas, { pointerId: 1, button: 0, clientX: 250, clientY: 125 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 250, clientY: 125 });
    expect(onMoveNode).toHaveBeenCalledWith(node.id, -300, 250, 'pointer');
  });

  it('pans by direct background drag and keyboard without a mode toggle', () => {
    const { nodes, edges } = mapFixture();
    const onViewportChange = vi.fn();
    const onAnnounce = vi.fn();
    const onSelect = vi.fn();
    render(<GraphCanvas
      nodes={nodes}
      edges={edges}
      selection={null}
      onSelect={onSelect}
      onMoveNode={vi.fn()}
      viewport={{ panX: 10, panY: 20, zoom: 1 }}
      phoneLayout={false}
      mapLabel="Micro-level map"
      onViewportChange={onViewportChange}
      onAnnounce={onAnnounce}
    />);

    const canvas = screen.getByRole('group', { name: /Drag the map or use arrow keys to pan/i });
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 840, bottom: 540, width: 840, height: 540, toJSON: () => ({}) });
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 200, clientY: 180 });
    fireEvent.pointerMove(canvas, { pointerId: 1, button: 0, clientX: 240, clientY: 215 });
    fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, clientX: 240, clientY: 215 });
    expect(onViewportChange).toHaveBeenCalledWith({ panX: 50, panY: 55, zoom: 1 });
    expect(onAnnounce).toHaveBeenCalledWith('Map moved.');

    onViewportChange.mockClear();
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(onViewportChange).toHaveBeenCalledWith({ panX: 50, panY: 20, zoom: 1 });
    expect(onAnnounce).toHaveBeenCalledWith('Map panned right.');
    expect(canvas).toHaveAttribute('aria-keyshortcuts', expect.not.stringContaining('Escape'));

    const connection = screen.getByRole('button', { name: /Rosa supports Peer support group/i });
    onViewportChange.mockClear();
    fireEvent.pointerDown(connection, { pointerId: 3, button: 0, clientX: 420, clientY: 270 });
    fireEvent.pointerMove(connection, { pointerId: 3, button: 0, clientX: 455, clientY: 300 });
    fireEvent.pointerUp(connection, { pointerId: 3, button: 0, clientX: 455, clientY: 300 });
    expect(onViewportChange).toHaveBeenCalledWith({ panX: 45, panY: 50, zoom: 1 });
    expect(onSelect).not.toHaveBeenCalledWith('edge', expect.anything(), true);

    fireEvent.pointerDown(connection, { pointerId: 4, button: 0, clientX: 420, clientY: 270 });
    fireEvent.pointerUp(connection, { pointerId: 4, button: 0, clientX: 420, clientY: 270 });
    expect(onSelect).toHaveBeenCalledWith('edge', 'edge-supports', true);
  });

  it('groups display, navigation, and map-changing actions without a Pan control', async () => {
    const { update } = renderMapStage();
    expect(screen.getByRole('heading', { name: 'Systems map' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Map display' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Map navigation' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Map actions' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pan' })).not.toBeInTheDocument();
    const moveButton = screen.getByRole('button', { name: 'Move' });
    fireEvent.click(moveButton);
    const moveControls = screen.getByRole('group', { name: 'Move map without dragging' });
    expect(moveControls).toBeVisible();
    fireEvent.keyDown(moveControls, { key: 'Escape' });
    await waitFor(() => expect(moveButton).toHaveFocus());
    expect(screen.queryByRole('group', { name: 'Move map without dragging' })).not.toBeInTheDocument();
    fireEvent.click(moveButton);
    fireEvent.click(screen.getByRole('button', { name: 'Move map right' }));
    expect(update).toHaveBeenCalled();

    const node = screen.getByRole('button', { name: /Rosa, person, Micro-level/i });
    fireEvent.keyDown(node, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Move Rosa without dragging' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Move Rosa right' }));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('introduces the selected item and keeps optional editing controls collapsed', () => {
    renderMapStage();
    fireEvent.keyDown(screen.getByRole('button', { name: /Rosa, person, Micro-level/i }), { key: 'Enter' });
    const panel = screen.getByRole('tabpanel', { name: 'Item' });
    expect(within(panel).queryByText(/Explain why this item matters/)).not.toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: 'Interpretation' })).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Delete' })).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Add record' })).not.toBeInTheDocument();
    expect(within(panel).getAllByRole('textbox')).toHaveLength(2);
    expect(within(panel).getByRole('textbox', { name: 'Interpretation' })).not.toHaveAttribute('placeholder');
    expect(within(panel).getByText('What does this node help explain? What is still uncertain?')).toBeVisible();
    expect(within(panel).getByRole('heading', { name: 'Edit' })).toBeVisible();
  });

  it('zooms around the pointer with a wheel and supports two-pointer pinch', () => {
    vi.useFakeTimers();
    const { nodes, edges } = mapFixture();
    const onViewportChange = vi.fn();
    const { unmount } = render(<GraphCanvas
      nodes={nodes}
      edges={edges}
      selection={null}
      onSelect={vi.fn()}
      onMoveNode={vi.fn()}
      viewport={{ panX: 0, panY: 0, zoom: 1 }}
      phoneLayout={false}
      mapLabel="Micro-level map"
      onViewportChange={onViewportChange}
      onAnnounce={vi.fn()}
    />);
    const canvas = screen.getByRole('group', { name: /mouse wheel or pinch to zoom/i });
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 840, bottom: 540, width: 840, height: 540, toJSON: () => ({}) });
    const wheelEvent = new WheelEvent('wheel', { deltaY: -100, clientX: 420, clientY: 270, bubbles: true, cancelable: true });
    fireEvent(canvas, wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(160);
    const wheelViewport = onViewportChange.mock.calls.at(-1)[0];
    expect(wheelViewport.zoom).toBeGreaterThan(1);
    expect((420 - wheelViewport.panX) / wheelViewport.zoom).toBeCloseTo(420, 4);
    expect((270 - wheelViewport.panY) / wheelViewport.zoom).toBeCloseTo(270, 4);
    unmount();

    onViewportChange.mockClear();
    vi.useRealTimers();
    render(<GraphCanvas
      nodes={nodes}
      edges={edges}
      selection={null}
      onSelect={vi.fn()}
      onMoveNode={vi.fn()}
      viewport={{ panX: 0, panY: 0, zoom: 1 }}
      phoneLayout={false}
      mapLabel="Micro-level map"
      onViewportChange={onViewportChange}
      onAnnounce={vi.fn()}
    />);
    const pinchCanvas = screen.getByRole('group', { name: /mouse wheel or pinch to zoom/i });
    pinchCanvas.getBoundingClientRect = canvas.getBoundingClientRect;
    fireEvent.pointerDown(pinchCanvas, { pointerId: 11, pointerType: 'touch', button: 0, clientX: 300, clientY: 270 });
    fireEvent.pointerDown(pinchCanvas, { pointerId: 12, pointerType: 'touch', button: 0, clientX: 500, clientY: 270 });
    fireEvent.pointerMove(pinchCanvas, { pointerId: 12, pointerType: 'touch', clientX: 600, clientY: 270 });
    fireEvent.pointerUp(pinchCanvas, { pointerId: 12, pointerType: 'touch', clientX: 600, clientY: 270 });
    expect(onViewportChange.mock.calls.at(-1)[0].zoom).toBeCloseTo(1.5, 2);
  });

  it('announces zoom and fit, and restores focus after fullscreen closes', async () => {
    renderMapStage();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText(/Map zoom \d+ percent\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    expect(screen.getByText('Map fitted to view.')).toBeInTheDocument();

    const fullscreen = screen.getByRole('button', { name: 'Full screen map' });
    fireEvent.click(fullscreen);
    await waitFor(() => expect(document.getElementById('systems-map-canvas')).toHaveFocus());
    expect(screen.getByText('Full screen map opened. Press Escape to exit.')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Full screen map' })).toHaveFocus());
    expect(screen.getByText('Full screen map closed.')).toBeInTheDocument();
  });

  it('moves focus into the map key and restores it to the trigger, including on Escape', async () => {
    renderMapStage();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    await waitFor(() => expect(document.querySelector('.map-stage')).toHaveClass('is-fullscreen'));
    const trigger = screen.getByRole('button', { name: 'Map key' });
    expect(trigger).toHaveAttribute('aria-controls', 'map-key-panel');
    fireEvent.click(trigger);

    const close = screen.getByRole('button', { name: 'Close map key' });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document.getElementById('map-key-panel'), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Close map key' })).not.toBeInTheDocument();
    expect(document.querySelector('.map-stage')).toHaveClass('is-fullscreen');
    expect(screen.getByText('Map key closed.')).toBeInTheDocument();
  });

  it('connects the mobile Details control to an inert inspector and moves focus into it when opened', async () => {
    renderMapStage({ phone: true });
    const details = screen.getByRole('button', { name: 'Details' });
    const inspector = document.getElementById('map-inspector');
    expect(details).toHaveAttribute('aria-controls', 'map-inspector');
    expect(inspector).toHaveAttribute('inert');

    fireEvent.click(details);
    await waitFor(() => expect(inspector).not.toHaveAttribute('inert'));
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tab', { name: 'Map' })).toHaveFocus();
  });

  it('keeps the work panel open for Suggestions and hands selection and Details back to the inspector mode', async () => {
    const onPanelMode = vi.fn();
    renderMapStage({ extraProps: { panel: { mode: 'suggestions', content: <p>Suggested items</p> }, onPanelMode, toolbarStart: <nav aria-label="Work level" /> } });
    const panel = screen.getByRole('complementary', { name: 'Suggestions panel' });
    expect(panel).not.toHaveAttribute('inert');
    expect(within(panel).getByText('Suggested items')).toBeVisible();
    const tabs = screen.getByRole('tablist', { name: 'Work panel' });
    expect(within(tabs).getByRole('tab', { name: 'Suggestions' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Work level' })).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Review' }));
    expect(onPanelMode).toHaveBeenLastCalledWith('review');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onPanelMode).toHaveBeenLastCalledWith('inspector');
    fireEvent.click(document.querySelector('[data-graph-id="node-rosa"]'));
    expect(onPanelMode).toHaveBeenLastCalledWith('inspector');
  });
});
