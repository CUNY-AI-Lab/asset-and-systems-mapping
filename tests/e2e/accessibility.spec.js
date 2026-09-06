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
    const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
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
    const yOrder = levels.map((level) => geometry.get(level)?.y).filter(Number.isFinite);
    const phonePortrait = canvas.getAttribute('viewBox')?.split(/\s+/).map(Number)?.[1] === -430;
    if (phonePortrait && yOrder.some((value, index) => index && value < yOrder[index - 1])) issues.push('level badges reverse the Micro-to-Macro reading order');
    return issues;
  });
}

async function ecologyRingGeometry(page) {
  return page.locator('.graph-canvas').evaluate((canvas) => {
    const viewport = canvas.querySelector('.viewport-layer');
    const zoom = Number(viewport.getAttribute('transform')?.match(/scale\(([-\d.]+)\)/)?.[1]);
    const rings = Object.fromEntries(['micro', 'meso', 'exosphere', 'macrosphere'].flatMap((level) => {
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

test.describe('student accessibility', () => {
  test('class entry and project list have no automatically detectable WCAG A or AA violations', async ({ page, makeAxeBuilder }, testInfo) => {
    const violations = [];
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Enter your class code' })).toBeVisible();
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
    await expect(page.getByRole('group', { name: 'Map display' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Map navigation' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Map actions' })).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Cumulative map canvas'));

    const layerSelect = page.getByRole('combobox', { name: 'Show map layer' });
    for (const layer of ['micro', 'meso', 'exosphere', 'macrosphere', 'all']) {
      await layerSelect.selectOption(layer);
      await page.getByRole('button', { name: 'Fit map' }).click();
      await expect.poll(() => clippedSemanticItems(page), { message: `${layer} semantic map content should fit` }).toEqual([]);
      await expect.poll(() => controlDockIssues(page), { message: `${layer} control docks should stay distinct` }).toEqual([]);
      await expect.poll(() => layerLabelNodeCollisions(page), { message: `${layer} level labels should not overlap nodes` }).toEqual([]);
      if (layer === 'all') await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Level badges should remain ordered inside their own rings' }).toEqual([]);
      if (layer === 'all' && testInfo.project.name.includes('phone')) {
        const smallestRenderedLabel = await page.locator('.node-label').evaluateAll((labels) => (
          Math.min(...labels.map((label) => label.getBoundingClientRect().height))
        ));
        expect(smallestRenderedLabel, 'Phone All layers labels should retain a readable rendered height').toBeGreaterThanOrEqual(10);
      }
    }

    await page.getByRole('button', { name: 'Map key' }).click();
    await expect(page.locator('.map-legend')).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Map key'));
    await page.getByRole('button', { name: 'Close map key' }).click();

    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('heading', { name: 'Map list' })).toBeVisible();
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Map list'));

    await page.getByRole('button', { name: 'Canvas' }).click();
    await page.getByRole('button', { name: 'Fit map' }).click();
    const fullScreenButton = page.getByRole('button', { name: 'Full screen map' });
    await fullScreenButton.click();
    await expect(page.locator('.map-stage')).toHaveClass(/is-fullscreen/);
    await expect(page.locator('.graph-canvas')).toBeFocused();
    await expect.poll(() => clippedSemanticItems(page), { message: 'Full-screen semantic map content should fit' }).toEqual([]);
    await expect.poll(() => controlDockIssues(page), { message: 'Full-screen control docks should stay distinct' }).toEqual([]);
    await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Full-screen level badges should remain ordered inside their own rings' }).toEqual([]);
    violations.push(...await scanAccessibility(page, makeAxeBuilder, testInfo, 'Full-screen cumulative map'));
    await captureSourceRenderedScreenshot(page, testInfo, 'Full-screen cumulative map');

    const beforeZoomOut = await ecologyRingGeometry(page);
    const expectedMacroRadius = testInfo.project.name.includes('phone') ? 630 : 1540;
    expect(beforeZoomOut.rings.macrosphere.rx).toBe(expectedMacroRadius);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    const afterZoomOut = await ecologyRingGeometry(page);
    expect(afterZoomOut.zoom).toBeLessThan(beforeZoomOut.zoom);
    expect(afterZoomOut.expansion).toBeGreaterThan(1);
    for (const level of Object.keys(beforeZoomOut.rings)) {
      expect(afterZoomOut.rings[level].rx).toBeGreaterThan(beforeZoomOut.rings[level].rx);
      expect(afterZoomOut.rings[level].ry).toBeGreaterThan(beforeZoomOut.rings[level].ry);
      expect(afterZoomOut.rings[level].renderedWidth).toBeGreaterThan(beforeZoomOut.rings[level].renderedWidth);
      expect(afterZoomOut.rings[level].renderedHeight).toBeGreaterThan(beforeZoomOut.rings[level].renderedHeight);
    }
    await expect.poll(() => clippedSemanticItems(page), { message: 'Explicit ring expansion should keep semantic map content visible' }).toEqual([]);
    await expect.poll(() => ecologyLabelMembershipIssues(page), { message: 'Expanded level badges should stay ordered inside their own rings' }).toEqual([]);
    await captureSourceRenderedScreenshot(page, testInfo, 'Full-screen cumulative map zoomed out');

    await page.keyboard.press('Escape');
    await expect(page.locator('.map-stage')).not.toHaveClass(/is-fullscreen/);
    await expect(page.getByRole('button', { name: 'Full screen map' })).toBeFocused();
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
