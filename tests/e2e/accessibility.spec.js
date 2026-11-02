import { openTools, mapCommand, notebookSection, showMap, projectMenu, preferences } from './support/notebook.js';
import {
  assertNoAccessibilityViolations,
  captureSourceRenderedScreenshot,
  expect,
  scanAccessibility,
  test,
} from './support/test.js';
import { serializedEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';

async function enterClass(page) {
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
}

async function seedCumulativeProject(page) {
  const project = serializedEastHarlemDisabilityProject();
  await page.addInitScript(({ key, value }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(key, value);
  }, { key: STORAGE_KEY, value: project });
}

async function clippedSemanticItems(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const canvasBounds = canvas.getBoundingClientRect();
    const selectors = ['.graph-node', '.edge-label-bg', '.ecology-layer.is-visible .ecology-layer__label'];
    return selectors.flatMap((selector) => [...canvas.querySelectorAll(selector)].flatMap((item) => {
      const style = getComputedStyle(item);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const bounds = item.getBoundingClientRect();
      const clipped = bounds.left < canvasBounds.left - 1
        || bounds.right > canvasBounds.right + 1
        || bounds.top < canvasBounds.top - 1
        || bounds.bottom > canvasBounds.bottom + 1;
      if (!clipped) return [];
      const owner = item.closest('[data-full-label], [data-edge-id]');
      return [{
        selector,
        label: owner?.getAttribute('data-full-label') || owner?.getAttribute('data-edge-id') || '[unknown]',
      }];
    }));
  });
}

async function controlDockIssues(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const canvasBounds = canvas.getBoundingClientRect();
    const groups = [...canvas.parentElement.querySelectorAll('.canvas-control-group')]
      .filter((group) => getComputedStyle(group).display !== 'none')
      .map((group) => ({ name: group.getAttribute('aria-label'), bounds: group.getBoundingClientRect() }));
    const issues = [];
    groups.forEach(({ name, bounds }) => {
      if (bounds.left < canvasBounds.left - 1 || bounds.right > canvasBounds.right + 1
        || bounds.top < canvasBounds.top - 1 || bounds.bottom > canvasBounds.bottom + 1) {
        issues.push(`${name} leaves the canvas`);
      }
    });
    groups.forEach((first, index) => groups.slice(index + 1).forEach((second) => {
      const overlapWidth = Math.min(first.bounds.right, second.bounds.right) - Math.max(first.bounds.left, second.bounds.left);
      const overlapHeight = Math.min(first.bounds.bottom, second.bounds.bottom) - Math.max(first.bounds.top, second.bounds.top);
      if (overlapWidth > 1 && overlapHeight > 1) issues.push(`${first.name} overlaps ${second.name}`);
    }));
    return issues;
  });
}

async function layerLabelNodeCollisions(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const nodes = [...canvas.querySelectorAll('.graph-node')].map((node) => ({
      name: node.getAttribute('data-full-label'),
      bounds: node.getBoundingClientRect(),
    }));
    const labels = [...canvas.querySelectorAll('.ecology-layer__label')].map((label) => ({
      level: label.closest('[data-ecology-layer]')?.getAttribute('data-ecology-layer'),
      bounds: label.getBoundingClientRect(),
    }));
    return nodes.flatMap((node) => labels.flatMap((label) => {
      const overlapWidth = Math.min(node.bounds.right, label.bounds.right) - Math.max(node.bounds.left, label.bounds.left);
      const overlapHeight = Math.min(node.bounds.bottom, label.bounds.bottom) - Math.max(node.bounds.top, label.bounds.top);
      return overlapWidth > 1 && overlapHeight > 1 ? [`${node.name} overlaps ${label.level}`] : [];
    }));
  });
}

async function ecologyLabelMembershipIssues(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const levels = ['micro', 'exosphere', 'macrosphere'];
    const geometry = new Map(levels.flatMap((level) => {
      const layer = canvas.querySelector(`[data-ecology-layer="${level}"]`);
      if (!layer) return [];
      const ellipse = layer.querySelector('ellipse');
      const label = layer.querySelector('.ecology-layer__label');
      const rect = label.querySelector('rect');
      const translate = label.getAttribute('transform')?.match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
      if (!ellipse || !rect || !translate) return [[level, { error: `${level} geometry is incomplete` }]];
      const x = Number(translate[1]);
      const y = Number(translate[2]);
      return [[level, {
        cx: Number(ellipse.getAttribute('cx')),
        cy: Number(ellipse.getAttribute('cy')),
        rx: Number(ellipse.getAttribute('rx')),
        ry: Number(ellipse.getAttribute('ry')),
        x,
        y,
        rect: {
          left: x + Number(rect.getAttribute('x')),
          right: x + Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
          top: y + Number(rect.getAttribute('y')),
          bottom: y + Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
        },
      }]];
    }));
    const issues = [];
    levels.forEach((level, index) => {
      const item = geometry.get(level);
      if (!item) return;
      if (item.error) {
        issues.push(item.error);
        return;
      }
      const { rect } = item;
      const corners = [
        [rect.left, rect.top], [rect.right, rect.top],
        [rect.left, rect.bottom], [rect.right, rect.bottom],
      ];
      const outerMetric = Math.max(...corners.map(([x, y]) => (
        ((x - item.cx) / item.rx) ** 2 + ((y - item.cy) / item.ry) ** 2
      )));
      if (outerMetric > 1.001) issues.push(`${level} badge leaves its outer ellipse`);
      if (!index) return;
      const inner = geometry.get(levels[index - 1]);
      if (!inner || inner.error) return;
      if (item.rx <= inner.rx || item.ry <= inner.ry) issues.push(`${level} ring is not outside ${levels[index - 1]}`);
      const nearestX = inner.cx < rect.left ? rect.left - inner.cx : inner.cx > rect.right ? inner.cx - rect.right : 0;
      const nearestY = inner.cy < rect.top ? rect.top - inner.cy : inner.cy > rect.bottom ? inner.cy - rect.bottom : 0;
      const innerMetric = (nearestX / inner.rx) ** 2 + (nearestY / inner.ry) ** 2;
      if (innerMetric < .999) issues.push(`${level} badge enters ${levels[index - 1]}`);
    });
    const badges=levels.map(level=>geometry.get(level)?.rect).filter(Boolean);
    badges.forEach((a,index)=>badges.slice(index+1).forEach(b=>{if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)issues.push('level badges overlap');}));
    return issues;
  });
}

async function ecologyRingGeometry(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const viewport = canvas.querySelector('.viewport-layer');
    const zoom = Number(viewport.getAttribute('transform')?.match(/scale\(([-\d.]+)\)/)?.[1]);
    const rings = Object.fromEntries(['micro', 'exosphere', 'macrosphere'].flatMap((level) => {
      const ellipse = canvas.querySelector(`[data-ecology-layer="${level}"] ellipse`);
      if (!ellipse) return [];
      const bounds = ellipse.getBoundingClientRect();
      return [[level, {
        rx: Number(ellipse.getAttribute('rx')),
        ry: Number(ellipse.getAttribute('ry')),
        renderedWidth: bounds.width,
        renderedHeight: bounds.height,
      }]];
    }));
    return { zoom, expansion: Number(canvas.getAttribute('data-ring-expansion')), rings };
  });
}

async function ecologyNodeGeometryIssues(page, { requireLayers = false } = {}) {
  return page.locator('.graph-canvas').evaluate(async (canvas, requiredLayers) => {
    await document.fonts.ready;
    const levels = ['micro', 'exosphere', 'macrosphere'];
    const issues = [];
    const nodes = [...canvas.querySelectorAll('.graph-node')];
    if (!nodes.length) issues.push('No graph nodes were available for geometry verification');
    const hasLayers = Boolean(canvas.querySelector('.ecology-layers'));
    const checkMembership = requiredLayers || (canvas.dataset.mapMode === 'ecology' && !canvas.classList.contains('is-detail-view'));
    if (checkMembership && !hasLayers) issues.push('Required ecology ring geometry is missing');

    const readBox = (element, name, allowEmpty = false) => {
      if (!element || typeof element.getBBox !== 'function') {
        issues.push(`${name} SVG geometry is missing`);
        return null;
      }
      try {
        const box = element.getBBox();
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite)
          || box.width < 0 || box.height < 0 || (!allowEmpty && (!box.width || !box.height))) {
          issues.push(`${name} SVG bounds are invalid`);
          return null;
        }
        return box;
      } catch (error) {
        issues.push(`${name} SVG bounds failed: ${error.message}`);
        return null;
      }
    };
    const corners = (box) => [
      { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
    ];
    const pointsIn = (points, source, target, name) => {
      try {
        const sourceMatrix = source.getCTM();
        const targetMatrix = target.getCTM();
        if (!sourceMatrix || !targetMatrix) throw new Error('coordinate transform is missing');
        const matrix = targetMatrix.inverse().multiply(sourceMatrix);
        const transformed = points.map((point) => new DOMPoint(point.x, point.y).matrixTransform(matrix));
        if (!transformed.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) throw new Error('coordinate transform is invalid');
        return transformed;
      } catch (error) {
        issues.push(`${name} SVG transform failed: ${error.message}`);
        return null;
      }
    };
    const rings = new Map();
    if (checkMembership) {
      for (const level of levels) {
        const ellipse = canvas.querySelector(`[data-ecology-layer="${level}"] > ellipse`);
        const attributes = ['cx', 'cy', 'rx', 'ry'].map((attribute) => ellipse?.getAttribute(attribute));
        const values = attributes.map(Number);
        if (!ellipse || attributes.some((value) => value == null || value.trim() === '')
          || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
          issues.push(`${level} ellipse geometry is missing or invalid`);
          continue;
        }
        const [cx, cy, rx, ry] = values;
        rings.set(level, { ellipse, cx, cy, rx, ry });
      }
    }
    const normalizedCard = (card, box, ring, name) => {
      const points = pointsIn(corners(box), card, ring.ellipse, name);
      return points?.map((point) => ({ x: (point.x - ring.cx) / ring.rx, y: (point.y - ring.cy) / ring.ry }));
    };
    // In normalized ellipse coordinates, the inner ellipse is the unit circle.
    // The nearest point lies on a rectangle edge, unless the rectangle contains
    // the ellipse's center. Checking only corners would miss inner-ring entry.
    const nearestMetric = (polygon) => {
      const crosses = polygon.map((point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        return (next.x - point.x) * -point.y - (next.y - point.y) * -point.x;
      });
      if (crosses.every((value) => value >= 0) || crosses.every((value) => value <= 0)) return 0;
      return Math.min(...polygon.map((point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, -(point.x * dx + point.y * dy) / lengthSquared)) : 0;
        return (point.x + t * dx) ** 2 + (point.y + t * dy) ** 2;
      }));
    };

    for (const node of nodes) {
      const name = node.getAttribute('data-full-label') || node.getAttribute('data-graph-id') || '[unidentified node]';
      const card = node.querySelector('.node-card');
      const cardBox = readBox(card, `${name} card`);
      if (!cardBox) continue;
      const label = node.querySelector('.node-label');
      const lines = [...(label?.querySelectorAll('tspan') || [])];
      if (!label || !lines.length) issues.push(`${name} label or line geometry is missing`);
      for (const [index, item] of [label, ...lines].entries()) {
        const itemName = `${name} ${index ? `line ${index}` : 'label'}`;
        const box = readBox(item, itemName, index > 0 && !item?.textContent.trim());
        if (!box) continue;
        const points = pointsIn(corners(box), item, card, itemName);
        if (points?.some((point) => point.x < cardBox.x - .01 || point.x > cardBox.x + cardBox.width + .01
          || point.y < cardBox.y - .01 || point.y > cardBox.y + cardBox.height + .01)) {
          issues.push(`${itemName} leaves its node card`);
        }
      }
      // Detail/focus views deliberately omit ring backdrops; text containment
      // still applies there, but an absent annulus cannot establish membership.
      if (!checkMembership) continue;
      const levelIndex = levels.findIndex((level) => node.classList.contains(`graph-node--${level}`));
      const outer = rings.get(levels[levelIndex]);
      if (levelIndex < 0 || !outer) {
        issues.push(`${name} semantic annulus geometry is missing`);
        continue;
      }
      const stroke = getComputedStyle(card).stroke === 'none' ? 0 : Number.parseFloat(getComputedStyle(card).strokeWidth);
      if (!Number.isFinite(stroke) || stroke < 0) {
        issues.push(`${name} card stroke geometry is invalid`);
        continue;
      }
      const completeCardBox = { x: cardBox.x - stroke / 2, y: cardBox.y - stroke / 2, width: cardBox.width + stroke, height: cardBox.height + stroke };
      const outerPoints = normalizedCard(card, completeCardBox, outer, `${name} outer ring`);
      const outerMetric = outerPoints && Math.max(...outerPoints.map((point) => point.x ** 2 + point.y ** 2));
      if (outerMetric != null && outerMetric > 1 + 1e-6) issues.push(`${name} whole card leaves ${levels[levelIndex]} outer ellipse (${outerMetric.toFixed(6)})`);
      if (levelIndex === 0) continue;
      const inner = rings.get(levels[levelIndex - 1]);
      if (!inner) {
        issues.push(`${name} inner annulus geometry is missing`);
        continue;
      }
      const innerPoints = normalizedCard(card, completeCardBox, inner, `${name} inner ring`);
      const innerMetric = innerPoints && nearestMetric(innerPoints);
      if (innerMetric != null && innerMetric < 1 - 1e-6) issues.push(`${name} whole card enters ${levels[levelIndex - 1]} inner ellipse (${innerMetric.toFixed(6)})`);
    }
    return issues;
  }, requireLayers);
}

test.describe('student accessibility', () => {
  test('class entry and project list have no automatically detectable WCAG A or AA violations', async ({ page, makeAxeBuilder }, testInfo) => {
    const violations = [];
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Systems Mapping' })).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Class entry'));

    await enterClass(page);
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Empty project list'));
    assertNoAccessibilityViolations(violations);
  });

  test('cumulative map canvas, key, list, and full-screen states remain accessible', async ({ page, makeAxeBuilder }, testInfo) => {
    const violations = [];
    await seedCumulativeProject(page);
    await page.goto('/');
    await enterClass(page);

    const projectCard = page.getByRole('article', { name: 'East Harlem disability resources' });
    await projectCard.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
    await expect(page.locator('.graph-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pan' })).toHaveCount(0);



    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Cumulative map canvas'));

    const layerSelect = page.getByRole('combobox', { name: 'Show map layer' });
    for (const layer of ['micro', 'meso', 'exosphere', 'macrosphere', 'all']) {
      await openTools(page);
      await layerSelect.selectOption(layer);
      await mapCommand(page, 'Fit map');
      await expect.poll(() => clippedSemanticItems(page), { message: `${layer} semantic map content should fit` }).toEqual([]);
      await expect.poll(() => controlDockIssues(page), { message: `${layer} control docks should stay distinct` }).toEqual([]);
      await expect.poll(() => layerLabelNodeCollisions(page), { message: `${layer} level labels should not overlap nodes` }).toEqual([]);
      await expect.poll(() => ecologyNodeGeometryIssues(page, { requireLayers: layer === 'all' }), { message: `${layer} whole node cards should stay in their annuli and contain their rendered labels` }).toEqual([]);
      if (layer === 'all') {
        await expect(page.locator('[data-ecology-layer="meso"]')).toHaveCount(0);
        await expect(page.locator('[data-ecology-layer]')).toHaveCount(3);
        await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Micro, Exo, and Macro badges should remain distinct inside their own rings' }).toEqual([]);
      }
      if (layer === 'micro') await expect(page.locator('.graph-edge')).toHaveCount(0);
      if (layer === 'meso') {
        await expect(page.locator('.graph-node')).toHaveCount(6);
        await expect(page.locator('.graph-edge')).toHaveCount(4);
        await expect(page.locator('[data-ecology-layer="meso"]')).toHaveCount(0);
      }
      if (layer === 'all' && testInfo.project.name.includes('phone')) {
        const smallestRenderedLabel = await page.locator('.node-label').evaluateAll((labels) => (
          Math.min(...labels.map((label) => label.getBoundingClientRect().height))
        ));
        expect(smallestRenderedLabel, 'Phone All layers labels should retain a readable rendered height').toBeGreaterThanOrEqual(10);
      }
    }

    await mapCommand(page, 'Map key');
    await expect(page.locator('.map-legend')).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Map key'));
    await page.getByRole('button', { name: 'Close map key' }).click();

    await mapCommand(page, 'List');
    await expect(page.getByRole('heading', { name: 'Map list' })).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Map list'));

    await mapCommand(page, 'Canvas');
    await mapCommand(page, 'Fit map');
    const fullScreenButton = page.getByRole('button', { name: 'Full screen map' });
    await mapCommand(page, 'Full screen map');
    await expect(page.locator('.map-stage')).toHaveClass(/is-fullscreen/);
    await expect(page.locator('.graph-canvas')).toBeFocused();
    await expect.poll(() => clippedSemanticItems(page), { message: 'Full-screen semantic map content should fit' }).toEqual([]);
    await expect.poll(() => controlDockIssues(page), { message: 'Full-screen control docks should stay distinct' }).toEqual([]);
    await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Full-screen level badges should remain ordered inside their own rings' }).toEqual([]);
    await expect.poll(() => ecologyNodeGeometryIssues(page, { requireLayers: true }), { message: 'Full-screen whole node cards should stay in their annuli and contain their rendered labels' }).toEqual([]);
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Full-screen cumulative map'));
    await captureSourceRenderedScreenshot(page, testInfo, 'Full-screen cumulative map');

    const beforeZoomOut = await ecologyRingGeometry(page);
    const expectedMacroRadius = testInfo.project.name.includes('phone') ? 520 : 1230;
    expect(beforeZoomOut.rings.macrosphere.rx, 'Macro ring must retain at least its baseline radius while allowing measured capacity growth').toBeGreaterThanOrEqual(expectedMacroRadius);
    await mapCommand(page, 'Zoom out');
    const afterZoomOut = await ecologyRingGeometry(page);
    expect(afterZoomOut.zoom).toBeLessThan(beforeZoomOut.zoom);
    expect(afterZoomOut.expansion).toBeGreaterThan(1);
    for (const level of Object.keys(beforeZoomOut.rings)) {
      expect(afterZoomOut.rings[level].rx).toBeGreaterThan(beforeZoomOut.rings[level].rx);
      expect(afterZoomOut.rings[level].ry).toBeGreaterThan(beforeZoomOut.rings[level].ry);
      expect(afterZoomOut.rings[level].renderedWidth / beforeZoomOut.rings[level].renderedWidth).toBeCloseTo(afterZoomOut.rings[level].rx / beforeZoomOut.rings[level].rx * afterZoomOut.zoom / beforeZoomOut.zoom, 4);
      expect(afterZoomOut.rings[level].renderedHeight / beforeZoomOut.rings[level].renderedHeight).toBeCloseTo(afterZoomOut.rings[level].ry / beforeZoomOut.rings[level].ry * afterZoomOut.zoom / beforeZoomOut.zoom, 4);
    }
    await expect.poll(() => clippedSemanticItems(page), { message: 'Explicit ring expansion should keep semantic map content visible' }).toEqual([]);
    await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Expanded level badges should stay ordered inside their own rings' }).toEqual([]);
    await expect.poll(() => ecologyNodeGeometryIssues(page, { requireLayers: true }), { message: 'Expanded whole node cards should stay in their annuli and contain their rendered labels' }).toEqual([]);
    await captureSourceRenderedScreenshot(page, testInfo, 'Full-screen cumulative map zoomed out');

    await page.keyboard.press('Escape');
    await expect(page.locator('.map-stage')).not.toHaveClass(/is-fullscreen/);
    await expect(page.locator('.notebook-map-tools > summary')).toBeFocused();
    assertNoAccessibilityViolations(violations);
  });

  test('canvas supports direct drag, pointer-centered wheel zoom, and touch pinch without a Pan mode', async ({ page }, testInfo) => {
    await seedCumulativeProject(page);
    await page.goto('/');
    await enterClass(page);
    await page.getByRole('article', { name: 'East Harlem disability resources' }).getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByRole('heading', { name: 'Systems map' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pan' })).toHaveCount(0);

    const canvas = page.locator('.graph-canvas');
    const viewportLayer = page.locator('.viewport-layer');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const point = await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (const yRatio of [0.3, 0.45, 0.6, 0.72]) {
        for (const xRatio of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) {
          const candidate = { x: bounds.left + bounds.width * xRatio, y: bounds.top + bounds.height * yRatio };
          const hit = document.elementFromPoint(candidate.x, candidate.y);
          if (hit && element.contains(hit) && !hit.closest('.graph-node, .graph-edge, .canvas-control-group')) return candidate;
        }
      }
      throw new Error('No unobstructed map point was available for direct-pan verification.');
    });
    const beforeDrag = await viewportLayer.getAttribute('transform');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 54, point.y + 32, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => viewportLayer.getAttribute('transform')).not.toBe(beforeDrag);

    const beforeWheel = await viewportLayer.getAttribute('transform');
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(220);
    await expect.poll(() => viewportLayer.getAttribute('transform')).not.toBe(beforeWheel);

    if (testInfo.project.name.includes('phone')) {
      const beforePinch = await viewportLayer.getAttribute('transform');
      const session = await page.context().newCDPSession(page);
      const midpoint = { x: box.x + box.width * 0.48, y: box.y + box.height * 0.44 };
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: midpoint.x - 36, y: midpoint.y, radiusX: 6, radiusY: 6, id: 11 },
          { x: midpoint.x + 36, y: midpoint.y, radiusX: 6, radiusY: 6, id: 12 },
        ],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: midpoint.x - 70, y: midpoint.y, radiusX: 6, radiusY: 6, id: 11 },
          { x: midpoint.x + 70, y: midpoint.y, radiusX: 6, radiusY: 6, id: 12 },
        ],
      });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => viewportLayer.getAttribute('transform')).not.toBe(beforePinch);
      await session.detach();
    }
  });
});
