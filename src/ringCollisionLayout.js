const TAU = Math.PI * 2;
const DEFAULT_PADDING = 12;
const DEFAULT_BOUNDARY_PADDING = 10;
const DEFAULT_ANGULAR_STEPS = 96;
const DEFAULT_RADIAL_STEPS = 14;

function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new TypeError(`${name} must be greater than zero.`);
  return number;
}

function normalizedNode(node, index) {
  if (!node || typeof node !== 'object') throw new TypeError(`nodes[${index}] must be an object.`);
  if (typeof node.id !== 'string' || !node.id) throw new TypeError(`nodes[${index}].id must be a non-empty string.`);
  if (typeof node.scale !== 'string' || !node.scale) throw new TypeError(`nodes[${index}].scale must be a non-empty string.`);
  return {
    source: node,
    index,
    id: node.id,
    scale: node.scale,
    x: finiteNumber(node.x, `nodes[${index}].x`),
    y: finiteNumber(node.y, `nodes[${index}].y`),
    width: positiveNumber(node.width, `nodes[${index}].width`),
    height: positiveNumber(node.height, `nodes[${index}].height`),
  };
}

function normalizedBand(band, scale) {
  if (!band || typeof band !== 'object') throw new TypeError(`A ring band is required for scale "${scale}".`);
  const outerRx = positiveNumber(band.outerRx, `bands.${scale}.outerRx`);
  const outerRy = positiveNumber(band.outerRy, `bands.${scale}.outerRy`);
  const innerRx = band.innerRx == null ? 0 : finiteNumber(band.innerRx, `bands.${scale}.innerRx`);
  const innerRy = band.innerRy == null ? 0 : finiteNumber(band.innerRy, `bands.${scale}.innerRy`);
  if (innerRx < 0 || innerRy < 0) throw new TypeError(`bands.${scale} inner radii cannot be negative.`);
  if (innerRx >= outerRx || innerRy >= outerRy) throw new TypeError(`bands.${scale} inner radii must be smaller than its outer radii.`);
  if ((innerRx === 0) !== (innerRy === 0)) throw new TypeError(`bands.${scale} inner radii must either both be zero or both be positive.`);
  return { innerRx, innerRy, outerRx, outerRy };
}

function rectangleBounds(node, position, padding = 0) {
  return {
    left: position.x - node.width / 2 - padding,
    right: position.x + node.width / 2 + padding,
    top: position.y - node.height / 2 - padding,
    bottom: position.y + node.height / 2 + padding,
  };
}

function boundsIntersect(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function collisionDepth(leftNode, leftPosition, rightNode, rightPosition, padding) {
  const overlapX = (leftNode.width + rightNode.width) / 2 + padding - Math.abs(leftPosition.x - rightPosition.x);
  const overlapY = (leftNode.height + rightNode.height) / 2 + padding - Math.abs(leftPosition.y - rightPosition.y);
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { overlapX, overlapY, area: overlapX * overlapY };
}

// A tiny deterministic broad-phase index avoids adding a layout dependency for
// the project's bounded node count. d3-quadtree is not currently installed.
class RectGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  keys(bounds) {
    const keys = [];
    const firstX = Math.floor(bounds.left / this.cellSize);
    const lastX = Math.floor(bounds.right / this.cellSize);
    const firstY = Math.floor(bounds.top / this.cellSize);
    const lastY = Math.floor(bounds.bottom / this.cellSize);
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  add(entry) {
    this.keys(entry.bounds).forEach((key) => {
      const cell = this.cells.get(key) || [];
      cell.push(entry);
      this.cells.set(key, cell);
    });
  }

  query(bounds) {
    const found = new Map();
    this.keys(bounds).forEach((key) => {
      (this.cells.get(key) || []).forEach((entry) => found.set(entry.node.id, entry));
    });
    return [...found.values()];
  }
}

function radialInterval(node, angle, band, boundaryPadding) {
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const outerRx = band.outerRx - boundaryPadding;
  const outerRy = band.outerRy - boundaryPadding;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  if (outerRx <= halfWidth || outerRy <= halfHeight) return null;

  // Solve for the furthest center on this ray whose furthest rectangle corner
  // remains inside the outer ellipse.
  const a = (cosine / outerRx) ** 2 + (sine / outerRy) ** 2;
  const b = 2 * ((cosine * halfWidth) / (outerRx ** 2) + (sine * halfHeight) / (outerRy ** 2));
  const c = (halfWidth / outerRx) ** 2 + (halfHeight / outerRy) ** 2 - 1;
  const discriminant = b ** 2 - 4 * a * c;
  if (discriminant < 0 || a <= 0) return null;
  const maximum = (-b + Math.sqrt(discriminant)) / (2 * a);
  if (maximum < 0) return null;

  if (!band.innerRx && !band.innerRy) return { minimum: 0, maximum };
  const innerRx = band.innerRx + boundaryPadding;
  const innerRy = band.innerRy + boundaryPadding;
  const nearestMetric = (distance) => (
    (Math.max(0, cosine * distance - halfWidth) / innerRx) ** 2
    + (Math.max(0, sine * distance - halfHeight) / innerRy) ** 2
  );
  if (nearestMetric(maximum) < 1) return null;
  let lower = 0;
  let upper = maximum;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (nearestMetric(middle) >= 1) upper = middle;
    else lower = middle;
  }
  return { minimum: upper, maximum };
}

function stableFallbackAngle(index) {
  // The golden angle prevents nodes with the same saved center from sharing a
  // preferred ray while remaining repeatable across runs.
  return -Math.PI / 2 + index * Math.PI * (3 - Math.sqrt(5));
}

function roundedPosition(center, angle, distance) {
  return {
    x: Math.round((center.x + Math.cos(angle) * distance) * 100) / 100,
    y: Math.round((center.y + Math.sin(angle) * distance) * 100) / 100,
  };
}

function projectToBand(node, position, band, center, boundaryPadding, fallbackAngle) {
  const deltaX = position.x - center.x;
  const deltaY = position.y - center.y;
  const atCenter = Math.hypot(deltaX, deltaY) < 0.001;
  const angle = atCenter ? fallbackAngle : Math.atan2(deltaY, deltaX);
  const interval = radialInterval(node, angle, band, boundaryPadding);
  if (!interval) return null;
  const requestedDistance = atCenter && interval.minimum === 0 ? 0 : Math.hypot(deltaX, deltaY);
  const distance = Math.min(interval.maximum, Math.max(interval.minimum, requestedDistance));
  return roundedPosition(center, angle, distance);
}

function candidatePositions(node, preferred, band, center, boundaryPadding, angularSteps, radialSteps, fallbackAngle) {
  const candidates = new Map();
  const add = (position) => {
    if (position) candidates.set(`${position.x}:${position.y}`, position);
  };
  add(projectToBand(node, preferred, band, center, boundaryPadding, fallbackAngle));
  const deltaX = preferred.x - center.x;
  const deltaY = preferred.y - center.y;
  const preferredAngle = Math.hypot(deltaX, deltaY) < 0.001 ? fallbackAngle : Math.atan2(deltaY, deltaX);
  const preferredDistance = Math.hypot(deltaX, deltaY);

  for (let angleIndex = 0; angleIndex < angularSteps; angleIndex += 1) {
    const signedStep = angleIndex === 0
      ? 0
      : (angleIndex % 2 ? Math.ceil(angleIndex / 2) : -Math.ceil(angleIndex / 2));
    const angle = preferredAngle + signedStep * TAU / angularSteps;
    const interval = radialInterval(node, angle, band, boundaryPadding);
    if (!interval) continue;
    const closestDistance = Math.min(interval.maximum, Math.max(interval.minimum, preferredDistance));
    add(roundedPosition(center, angle, closestDistance));
    for (let radialIndex = 0; radialIndex <= radialSteps; radialIndex += 1) {
      const distance = interval.minimum + (interval.maximum - interval.minimum) * radialIndex / radialSteps;
      add(roundedPosition(center, angle, distance));
    }
  }

  return [...candidates.values()].sort((left, right) => {
    const leftDistance = (left.x - preferred.x) ** 2 + (left.y - preferred.y) ** 2;
    const rightDistance = (right.x - preferred.x) ** 2 + (right.y - preferred.y) ** 2;
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
}

function positionPenalty(node, position, neighbors, padding) {
  return neighbors.reduce((total, entry) => {
    const depth = collisionDepth(node, position, entry.node, entry.position, padding);
    return total + (depth ? depth.area : 0);
  }, 0);
}

/**
 * Resolve axis-aligned card collisions without moving a node outside its
 * ecological scale band.
 *
 * The caller owns text measurement and supplies each complete card's width and
 * height. The function never reads, shortens, or rewrites a label. Returned
 * nodes preserve the exact input order and every input property except x/y.
 */
export function resolveRingConstrainedCollisions(nodes, {
  center,
  bands,
  padding = DEFAULT_PADDING,
  boundaryPadding = DEFAULT_BOUNDARY_PADDING,
  angularSteps = DEFAULT_ANGULAR_STEPS,
  radialSteps = DEFAULT_RADIAL_STEPS,
} = {}) {
  if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array.');
  if (!center || typeof center !== 'object') throw new TypeError('center is required.');
  const normalizedCenter = {
    x: finiteNumber(center.x, 'center.x'),
    y: finiteNumber(center.y, 'center.y'),
  };
  if (!bands || typeof bands !== 'object') throw new TypeError('bands are required.');
  if (!Number.isFinite(padding) || padding < 0) throw new TypeError('padding cannot be negative.');
  if (!Number.isFinite(boundaryPadding) || boundaryPadding < 0) throw new TypeError('boundaryPadding cannot be negative.');
  if (!Number.isInteger(angularSteps) || angularSteps < 8) throw new TypeError('angularSteps must be an integer of at least 8.');
  if (!Number.isInteger(radialSteps) || radialSteps < 1) throw new TypeError('radialSteps must be a positive integer.');

  const normalized = nodes.map(normalizedNode);
  const seenIds = new Set();
  normalized.forEach((node) => {
    if (seenIds.has(node.id)) throw new TypeError(`Node id "${node.id}" is duplicated.`);
    seenIds.add(node.id);
  });
  const bandByScale = new Map([...new Set(normalized.map((node) => node.scale))]
    .map((scale) => [scale, normalizedBand(bands[scale], scale)]));
  const cellSize = Math.max(64, ...normalized.map((node) => Math.max(node.width, node.height) + padding));
  const grid = new RectGrid(cellSize);
  const placements = new Map();
  const unplaced = [];

  normalized.forEach((node) => {
    const band = bandByScale.get(node.scale);
    const fallbackAngle = stableFallbackAngle(node.index);
    const candidates = candidatePositions(
      node,
      { x: node.x, y: node.y },
      band,
      normalizedCenter,
      boundaryPadding,
      angularSteps,
      radialSteps,
      fallbackAngle,
    );
    if (!candidates.length) {
      placements.set(node.id, { x: node.x, y: node.y });
      unplaced.push({ id: node.id, scale: node.scale, reason: 'card-does-not-fit-band' });
      return;
    }

    let chosen = null;
    let fallback = null;
    let fallbackPenalty = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate) => {
      if (chosen) return;
      const bounds = rectangleBounds(node, candidate, padding);
      const neighbors = grid.query(bounds);
      const collides = neighbors.some((entry) => collisionDepth(node, candidate, entry.node, entry.position, padding));
      if (!collides) {
        chosen = candidate;
        return;
      }
      const penalty = positionPenalty(node, candidate, neighbors, padding);
      if (penalty < fallbackPenalty) {
        fallback = candidate;
        fallbackPenalty = penalty;
      }
    });
    chosen ||= fallback || candidates[0];
    placements.set(node.id, chosen);
    grid.add({ node, position: chosen, bounds: rectangleBounds(node, chosen) });
    if (fallback && chosen === fallback) unplaced.push({ id: node.id, scale: node.scale, reason: 'band-capacity-exceeded' });
  });

  const collisions = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const depth = collisionDepth(left, placements.get(left.id), right, placements.get(right.id), padding);
      if (depth) collisions.push({ firstId: left.id, secondId: right.id, overlapX: depth.overlapX, overlapY: depth.overlapY });
    }
  }

  return {
    nodes: normalized.map((node) => ({ ...node.source, ...placements.get(node.id) })),
    positions: new Map(normalized.map((node) => [node.id, placements.get(node.id)])),
    collisions,
    unplaced,
    converged: collisions.length === 0 && unplaced.length === 0,
  };
}

export function rectanglesOverlap(left, right, padding = DEFAULT_PADDING) {
  return Boolean(collisionDepth(
    { width: positiveNumber(left.width, 'left.width'), height: positiveNumber(left.height, 'left.height') },
    { x: finiteNumber(left.x, 'left.x'), y: finiteNumber(left.y, 'left.y') },
    { width: positiveNumber(right.width, 'right.width'), height: positiveNumber(right.height, 'right.height') },
    { x: finiteNumber(right.x, 'right.x'), y: finiteNumber(right.y, 'right.y') },
    padding,
  ));
}

export function rectangleFitsRingBand(node, band, center, boundaryPadding = DEFAULT_BOUNDARY_PADDING) {
  const normalized = normalizedNode(node, 0);
  const normalizedRing = normalizedBand(band, normalized.scale);
  const normalizedCenter = {
    x: finiteNumber(center.x, 'center.x'),
    y: finiteNumber(center.y, 'center.y'),
  };
  const deltaX = normalized.x - normalizedCenter.x;
  const deltaY = normalized.y - normalizedCenter.y;
  const angle = Math.hypot(deltaX, deltaY) < 0.001 ? 0 : Math.atan2(deltaY, deltaX);
  const interval = radialInterval(normalized, angle, normalizedRing, boundaryPadding);
  if (!interval) return false;
  const distance = Math.hypot(deltaX, deltaY);
  return distance >= interval.minimum - 0.02 && distance <= interval.maximum + 0.02;
}
