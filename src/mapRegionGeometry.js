// Regions describe membership, not a radius around a node's center. Their
// hull includes each complete card, and unrelated cards are mask exclusions.
export function mapRegionGeometry(memberIds, visuals, padding = 12) {
  const members = new Set(memberIds);
  const boundsFor = ({ position, geometry }, margin) => ({
    left: position.x - geometry.cardWidth / 2 - margin,
    right: position.x + geometry.cardWidth / 2 + margin,
    top: position.y - geometry.cardHeight / 2 - margin,
    bottom: position.y + geometry.cardHeight / 2 + margin,
  });
  const boxes = [...members].flatMap(id => {
    const visual = visuals.get(id);
    return visual?.position && visual.geometry ? [boundsFor(visual, padding)] : [];
  });
  if (!boxes.length) return null;
  const points = boxes.flatMap(box => [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
  ]);
  const unique = [...new Map(points.map(point => [`${point.x}:${point.y}`, point])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const half = input => {
    const result = [];
    for (const point of input) {
      while (result.length >= 2 && cross(result.at(-2), result.at(-1), point) <= 0) result.pop();
      result.push(point);
    }
    return result;
  };
  const hull = [...half(unique).slice(0, -1), ...half([...unique].reverse()).slice(0, -1)];
  const bounds = {
    left: Math.min(...boxes.map(box => box.left)), right: Math.max(...boxes.map(box => box.right)),
    top: Math.min(...boxes.map(box => box.top)), bottom: Math.max(...boxes.map(box => box.bottom)),
  };
  const exclusions = [...visuals].flatMap(([id, visual]) => {
    if (members.has(id) || !visual?.position || !visual.geometry) return [];
    const box = boundsFor(visual, 4);
    if (box.right <= bounds.left || box.left >= bounds.right || box.bottom <= bounds.top || box.top >= bounds.bottom) return [];
    return [{ id, ...box }];
  });
  return { bounds, exclusions, hull, path: `M ${hull.map(point => `${point.x} ${point.y}`).join(' L ')} Z` };
}
