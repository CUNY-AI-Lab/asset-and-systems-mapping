import { describe, expect, it } from 'vitest';
import {
  projectRectangleToRing,
  rectangleFitsRing,
  rectangleFitsRingBand,
  rectanglesOverlap,
  resolveRingConstrainedCollisions,
} from './ringCollisionLayout.js';

const CENTER = Object.freeze({ x: 1_600, y: 1_200 });
const BANDS = Object.freeze({
  micro: Object.freeze({ innerRx: 0, innerRy: 0, outerRx: 600, outerRy: 420 }),
  meso: Object.freeze({ innerRx: 600, innerRy: 420, outerRx: 910, outerRy: 650 }),
  exosphere: Object.freeze({ innerRx: 910, innerRy: 650, outerRx: 1_220, outerRy: 880 }),
  macrosphere: Object.freeze({ innerRx: 1_220, innerRy: 880, outerRx: 1_540, outerRy: 1_140 }),
});

describe('exact rectangle ring projection', () => {
  const desktop = { width: 224, height: 72, center: CENTER, band: BANDS.micro, boundaryPadding: 16 };

  it('keeps the complete diagonal desktop Micro card inside its outer contour', () => {
    // The former shrunk-axis projection returned (1890,1490), whose
    // furthest card corner had an outer-ellipse metric of 1.05137.
    expect(rectangleFitsRing({ x: 1_890, y: 1_490 }, desktop)).toBe(false);
    const position = projectRectangleToRing({ x: 2_100, y: 1_700 }, desktop);
    expect(position).not.toBeNull();
    expect(rectangleFitsRing(position, desktop)).toBe(true);
    const corners = [-1, 1].flatMap((xSign) => [-1, 1].map((ySign) => ({
      x: position.x + xSign * desktop.width / 2,
      y: position.y + ySign * desktop.height / 2,
    })));
    corners.forEach(({ x, y }) => expect(
      ((x - CENTER.x) / (BANDS.micro.outerRx - 16)) ** 2
        + ((y - CENTER.y) / (BANDS.micro.outerRy - 16)) ** 2,
    ).toBeLessThanOrEqual(1 + 1e-10));
  });

  it('projects a Meso card out of the inner ellipse while respecting every outer corner', () => {
    const options = { ...desktop, band: BANDS.meso };
    expect(rectangleFitsRing(CENTER, options)).toBe(false);
    const position = projectRectangleToRing({ x: 1_850, y: 1_450 }, options);
    expect(position).not.toBeNull();
    expect(rectangleFitsRing(position, options)).toBe(true);
    const nearestX = Math.max(0, Math.abs(position.x - CENTER.x) - options.width / 2);
    const nearestY = Math.max(0, Math.abs(position.y - CENTER.y) - options.height / 2);
    expect((nearestX / (BANDS.meso.innerRx + 16)) ** 2
      + (nearestY / (BANDS.meso.innerRy + 16)) ** 2).toBeGreaterThanOrEqual(1 - 1e-10);
  });

  it('searches alternate rays when the requested Meso direction has no rectangle clearance', () => {
    const options = {
      width: 272, height: 112, center: CENTER, boundaryPadding: 16,
      band: { innerRx: 300, innerRy: 380, outerRx: 410, outerRy: 620 },
    };
    const position = projectRectangleToRing({ x: 2_100, y: CENTER.y }, options);
    expect(position).not.toBeNull();
    expect(Math.abs(position.y - CENTER.y)).toBeGreaterThan(0);
    expect(rectangleFitsRing(position, options)).toBe(true);
  });

  it('returns null for a card that cannot fit the skinny compact phone Meso band', () => {
    const options = {
      width: 272, height: 112, center: CENTER, boundaryPadding: 16,
      band: { innerRx: 300, innerRy: 380, outerRx: 410, outerRy: 500 },
    };
    expect(rectangleFitsRing({ x: CENTER.x, y: 748 }, options)).toBe(false);
    expect(projectRectangleToRing({ x: CENTER.x, y: 700 }, options)).toBeNull();
  });

  it('is deterministic and stable without rounding already valid or projected positions', () => {
    const valid = { x: 1_337.1234, y: 1_183.4321 };
    expect(projectRectangleToRing(valid, desktop)).toEqual(valid);
    const request = { x: 2_100, y: 1_700 };
    const projected = projectRectangleToRing(request, desktop);
    expect(projectRectangleToRing(request, desktop)).toEqual(projected);
    expect(projectRectangleToRing(projected, desktop)).toEqual(projected);
  });
});

function card(id, scale, x = CENTER.x, y = CENTER.y, overrides = {}) {
  return {
    id,
    scale,
    label: `Complete label for ${id}`,
    x,
    y,
    width: 224,
    height: 72,
    evidence: `Evidence for ${id}`,
    ...overrides,
  };
}

function expectNoOverlaps(nodes, padding = 12) {
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      expect(rectanglesOverlap(nodes[first], nodes[second], padding), `${nodes[first].id} overlaps ${nodes[second].id}`).toBe(false);
    }
  }
}

describe('ring-constrained rectangle layout', () => {
  it('separates overlapping cards while preserving their scale bands, full labels, properties, and input order', () => {
    const longLabel = 'New York State Office for People With Developmental Disabilities and Community-Based Access Coordination';
    const nodes = [
      card('micro_a', 'micro', CENTER.x, CENTER.y, { label: longLabel, height: 126 }),
      card('micro_b', 'micro'),
      card('meso_a', 'meso'),
      card('meso_b', 'meso'),
      card('exo_a', 'exosphere'),
      card('exo_b', 'exosphere'),
      card('macro_a', 'macrosphere'),
      card('macro_b', 'macrosphere'),
    ];

    const result = resolveRingConstrainedCollisions(nodes, { center: CENTER, bands: BANDS });

    expect(result.converged).toBe(true);
    expect(result.collisions).toEqual([]);
    expect(result.unplaced).toEqual([]);
    expect(result.nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(result.nodes[0].label).toBe(longLabel);
    expect(result.nodes[0].evidence).toBe(nodes[0].evidence);
    result.nodes.forEach((node) => expect(rectangleFitsRingBand(node, BANDS[node.scale], CENTER)).toBe(true));
    expectNoOverlaps(result.nodes);
  });

  it('is deterministic even when every saved node begins at the same coordinates', () => {
    const nodes = Array.from({ length: 18 }, (_, index) => card(
      `node_${String(index).padStart(2, '0')}`,
      index < 6 ? 'micro' : index < 10 ? 'meso' : index < 14 ? 'exosphere' : 'macrosphere',
      CENTER.x,
      CENTER.y,
      { height: 72 + index % 3 * 22 },
    ));

    const first = resolveRingConstrainedCollisions(nodes, { center: CENTER, bands: BANDS });
    const second = resolveRingConstrainedCollisions(nodes, { center: CENTER, bands: BANDS });

    expect(first.converged).toBe(true);
    expect(first.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(second.nodes.map(({ id, x, y }) => ({ id, x, y })));
    expectNoOverlaps(first.nodes);
    first.nodes.forEach((node) => expect(rectangleFitsRingBand(node, BANDS[node.scale], CENTER)).toBe(true));
  });

  it('keeps already valid, separated cards at their saved positions', () => {
    const nodes = [
      card('left', 'micro', CENTER.x - 260, CENTER.y),
      card('right', 'micro', CENTER.x + 260, CENTER.y),
      card('exo', 'exosphere', CENTER.x + 1_050, CENTER.y),
    ];

    const result = resolveRingConstrainedCollisions(nodes, { center: CENTER, bands: BANDS });

    expect(result.converged).toBe(true);
    expect(result.nodes.map(({ x, y }) => ({ x, y }))).toEqual(nodes.map(({ x, y }) => ({ x, y })));
  });

  it('reports an impossible card instead of silently putting it outside its assigned band', () => {
    const impossible = card('too_large', 'micro', CENTER.x, CENTER.y, { width: 1_400, height: 1_000 });

    const result = resolveRingConstrainedCollisions([impossible], { center: CENTER, bands: BANDS });

    expect(result.converged).toBe(false);
    expect(result.unplaced).toEqual([{ id: impossible.id, scale: 'micro', reason: 'card-does-not-fit-band' }]);
    expect(result.nodes[0]).toMatchObject(impossible);
  });

  it('validates malformed geometry and missing scale bands at the module boundary', () => {
    expect(() => resolveRingConstrainedCollisions([
      card('bad_width', 'micro', CENTER.x, CENTER.y, { width: 0 }),
    ], { center: CENTER, bands: BANDS })).toThrow(/width must be greater than zero/);
    expect(() => resolveRingConstrainedCollisions([
      card('unknown', 'unknown'),
    ], { center: CENTER, bands: BANDS })).toThrow(/ring band is required/);
    expect(() => resolveRingConstrainedCollisions([
      card('duplicate', 'micro'),
      card('duplicate', 'micro'),
    ], { center: CENTER, bands: BANDS })).toThrow(/duplicated/);
  });
});
