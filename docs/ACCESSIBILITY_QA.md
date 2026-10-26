# Accessibility QA

The automated accessibility harness opens a fresh local build of Systems Mapping in Chromium at desktop and phone viewports. It never connects to the hosted application, PostgreSQL, Ollama, or OpenRouter. Each run creates a temporary SQLite database under the operating system temporary directory and removes it after the browser run.

The cumulative-map fixture is fabricated. It contains no information about a real person or organization. Browser contexts are fresh for every test, and the fixture enters the application through the same durable browser-storage format used by the student interface. No test-only production route or runtime bypass is present.

## Commands

Install the locked Chromium binary once after installing dependencies:

```bash
pnpm exec playwright install chromium
```

Run the accessibility checks:

```bash
pnpm test:a11y
```

Run every Playwright check or inspect it in a visible browser:

```bash
pnpm test:e2e
pnpm test:e2e:headed
```

Playwright output is written to ignored `test-results/` and `playwright-report/` directories. Full-screen map screenshots are raw `page.screenshot()` PNG files from the built application. Each screenshot is paired with JSON recording the source commit, dirty-tree state, source-diff digest, built-bundle digest, browser, viewport, URL, capture method, image digest, and `generated: false`. A dirty working tree must never be represented by its HEAD commit alone.

## Automated scope

The gate uses `@axe-core/playwright` without disabled rules or exclusions. It checks WCAG 2.0, 2.1, and 2.2 Level A and AA tags in these student states:

- class-code entry;
- empty project list;
- cumulative four-level map canvas;
- open Map key;
- map List alternative;
- full-screen cumulative map;
- desktop at 1440 by 1000;
- phone at 390 by 844.

The browser checks also confirm that full-screen mode focuses the map canvas and that Escape closes full-screen mode and restores focus to its toggle.

## Map navigation and control contract

The map does not require a Pan toggle. A primary-pointer drag on the canvas or a connection pans immediately. A drag that begins on a node continues to move that node, while a node or connection tap opens its details only on release. When the canvas itself has keyboard focus, arrow keys pan the map; when a node has focus, arrow keys move the node. The compact `Move` disclosure provides four single-pointer direction controls, and an open node's `Position on map` controls provide the same non-dragging alternative for node placement.

Zoom has equivalent pointer, touch, keyboard, and button paths:

- a mouse wheel or trackpad scroll zooms around the pointer location;
- a two-pointer pinch zooms around the gesture midpoint;
- `−` and `+` remain 44-pixel controls with the accessible names `Zoom out` and `Zoom in`;
- every completed zoom announces `Map zoom {percent} percent.`;
- all zoom paths honor the same minimum and maximum scale.

`Fit map` is a semantic-content fit. It must keep every visible node card, connection label, and relationship field inside the usable canvas. It does not have to keep an unoccupied portion of an ecological ring visible. This permits the map to use the screen at a readable scale without cutting off mapped content. The visible phone label is `Fit`; its accessible name remains `Fit map`.

At phone widths, maps with up to 12 visible items use a portrait-scaled set of the same four concentric levels. This keeps the All layers overview legible without moving an item to the wrong level. Denser maps retain the larger geometry so collision avoidance has enough room and remain available through direct panning. The browser gate requires the smallest rendered node label in the phone All layers fixture to remain at least 10 CSS pixels high after fitting; this is a regression floor for the overview, not a general text-size target.

Canvas controls are separated into three named groups:

- `Map display`: Map key and full-screen entry or exit;
- `Map navigation`: Zoom out, Zoom in, Fit map, and the `Move` disclosure;
- `Map actions`: Arrange map and, on phone, Details.

The groups occupy separate canvas docks rather than one wrapping toolbar. On phone, the visible labels shorten to `Fit`, `Arrange`, and `Full screen`, while their accessible names remain `Fit map`, `Arrange map`, and `Full screen map`. Every control retains a minimum 44-pixel target. Opening the phone inspector makes the canvas chrome inert and removes it from the accessibility tree until the inspector closes.

The canvas accessible instruction is:

> `{map label}. {graph summary}. Choose a node or connection for details. Drag the map or use arrow keys to pan. Use the mouse wheel or pinch to zoom. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.`

The node-movement sentence is omitted in temporary detail views where node movement is unavailable.

## Map navigation QA

Automated component and browser checks for this control pass must verify:

- no Pan button or Pan-mode announcement remains;
- a canvas or connection drag pans without a preceding control click and announces `Map moved.`, while a tap opens details only on release;
- canvas arrow keys pan and announce direction, while node arrow keys move the node instead;
- wheel zoom preserves the map location under the pointer;
- two-pointer pinch changes zoom around the gesture midpoint;
- Zoom out, Zoom in, and Fit map remain operable alternatives to zoom gestures;
- `Move` supplies four non-dragging pointer controls for panning, and `Position on map` supplies four for the selected node;
- Escape closes the `Move` disclosure and restores focus to its trigger;
- the `Map display`, `Map navigation`, and `Map actions` groups have distinct accessible names;
- Map key opens as a labelled dialog, Escape closes it, and focus returns to Map key;
- full screen focuses the canvas, Escape exits, and focus returns to Full screen map;
- phone Details controls the inspector, the closed inspector is inert, and focus moves into the open inspector;
- desktop, phone, and full-screen control groups remain inside the canvas without overlap or wrapped labels;
- after automatic arrangement and after Fit map, every visible node card and connection label is inside the usable canvas even when part of the outer ring is outside it;
- the phone All layers overview retains the compact concentric structure and its rendered node labels stay above the regression floor;
- the Canvas/List alternative and each open Map key, inspector, and full-screen state pass the unchanged axe rule set.

Test the compact layouts at 320, 390, and 430 CSS pixels, the desktop layout at 1440 by 1000, and phone full screen. Fit assertions must use the usable map region after accounting for the top-right display dock and both bottom control docks, not merely the SVG's outer rectangle.

## Contextual wording edit QA

Check selected-item and candidate wording editors with keyboard and pointer input:

- **Save** and **Cancel** appear after a draft changes; Enter saves and Escape cancels without triggering map shortcuts.
- Invalid drafts expose an associated error, retain the saved wording, and return focus to the field.
- Moving focus does not save a draft. Selecting another map item discards the selected item’s unsaved wording.
- Successful Save preserves the camera and node positions at desktop and narrow phone widths; the edited text’s card may resize.
- Arrange and node movement remain usable after saving a long valid label.
- Save/Cancel controls retain 44-pixel targets and fit at 320, 390, and 430 CSS pixels.

## Map tools resizing QA

- The left-edge handle resizes the entire panel while its right edge stays anchored and the canvas bounds remain unchanged.
- The **Resize map tools** separator exposes its current width and bounds. Left widens and Right narrows by 16px; Shift changes it by 48px. Home or double-click restores 280px; End selects the available maximum, capped at 480px.
- Pointer cancellation or Escape during a drag restores the starting width without saving a partial resize. Completed resizing persists independently of Notebook width.
- At 600px and below, the handle is hidden and the compact width does not overwrite the desktop preference.
- The intake heading is **Memo**; **Add memo** remains the Progress stage label.

## Manual checks still required

Automated axe checks identify only a subset of accessibility problems. Before release, verify these behaviors manually with keyboard-only navigation and VoiceOver:

- skip and landmark navigation follow a useful order;
- every visible focus indicator remains clear at 200 percent zoom;
- modal focus remains contained and returns to the invoking control;
- node and connection names make sense when read without the diagram;
- Canvas and List communicate equivalent map content;
- arrow-key node movement and map panning announce understandable changes;
- direct drag, mouse-wheel zoom, and pinch zoom do not trigger a node move or open details accidentally;
- Zoom out, Zoom in, and Fit map remain understandable alternatives when gestures are unavailable;
- compact control labels expose their complete accessible names;
- map layers, scopes, and directions remain conceptually distinguishable without color;
- phone controls do not trap scrolling, focus, or touch exploration.

Do not suppress a failing axe rule to make this gate pass. Attach the emitted axe JSON to the defect, fix the rendered application, and rerun the unchanged rule set.
