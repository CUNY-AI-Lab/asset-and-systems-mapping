import { describe, expect, it } from 'vitest';
import { mapRegionGeometry } from './mapRegionGeometry.js';

const visual = (x, y, width = 224, height = 72) => ({ position: { x, y }, geometry: { cardWidth: width, cardHeight: height } });

describe('measured membership regions', () => {
  it('encloses every corner of a single complete card', () => {
    const region = mapRegionGeometry(['one'], new Map([['one', visual(400, 300)]]));
    expect(region.bounds).toEqual({ left: 276, right: 524, top: 252, bottom: 348 });
    expect(region.hull).toHaveLength(4);
    expect(region.exclusions).toEqual([]);
  });

  it('includes a tall last member rather than rounding a center-only capsule over it', () => {
    const region = mapRegionGeometry(['center', 'school', 'student'], new Map([
      ['center', visual(400, 200)], ['school', visual(400, 320)], ['student', visual(400, 470, 272, 168)],
    ]));
    expect(region.bounds.bottom).toBe(566);
    expect(region.bounds.left).toBe(252);
    expect(region.hull.some(point => point.y === 566)).toBe(true);
  });

  it('excludes the photographed nonmember Student instead of shading part of it', () => {
    const region = mapRegionGeometry(['center', 'school'], new Map([
      ['center', visual(400, 200)], ['school', visual(400, 320)], ['student', visual(400, 405)],
    ]));
    expect(region.bounds.bottom).toBe(368);
    expect(region.exclusions).toEqual([expect.objectContaining({ id: 'student', top: 365, bottom: 445 })]);
  });

  it('masks unrelated cards inside a multi-member hull', () => {
    const region = mapRegionGeometry(['left', 'right'], new Map([
      ['left', visual(200, 300)], ['right', visual(700, 300)], ['other', visual(450, 300)],
    ]));
    expect(region.exclusions).toEqual([expect.objectContaining({ id: 'other' })]);
    expect(region.exclusions.some(({ id }) => id === 'left' || id === 'right')).toBe(false);
  });

  it('ignores hidden/missing members without fabricating geometry', () => {
    expect(mapRegionGeometry(['missing'], new Map())).toBeNull();
  });

  it('moves the entire contour with pan-independent world coordinates', () => {
    const first = mapRegionGeometry(['one'], new Map([['one', visual(400, 300)]]));
    const shifted = mapRegionGeometry(['one'], new Map([['one', visual(475, 260)]]));
    expect(shifted.hull).toEqual(first.hull.map(({ x, y }) => ({ x: x + 75, y: y - 40 })));
  });
});
