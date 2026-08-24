import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('map workspace layout contract', () => {
  it('keeps the desktop map in document flow instead of trapping it in a viewport-height scroller', () => {
    expect(styles).toContain('.map-layout { min-height: 610px; grid-template-columns: minmax(0, 1fr); }');
    expect(styles).toContain('.canvas-wrap { min-height: 610px; overflow: hidden; touch-action: pan-y; }');
    expect(styles).not.toMatch(/\.workspace--stage-3\s*\{[^}]*height:\s*100dvh/);
    expect(styles).not.toMatch(/\.workspace--stage-3\s*\{[^}]*overflow:\s*auto/);
  });

  it('reserves fixed-footer space and keeps viewport locking exclusive to full-screen mode', () => {
    expect(styles).toContain('.workspace--stage-3 { padding-top: calc(var(--header) + var(--safe-top) + 30px); padding-bottom: calc(var(--footer) + var(--safe-bottom) + 30px); }');
    expect(styles).toContain('.map-stage.is-fullscreen {');
    expect(styles).toContain('height: 100dvh;');
    expect(styles).toContain('body.map-fullscreen-open { overflow: hidden; }');
  });

  it('lets the phone SVG share its fixed-height wrapper with the in-flow controls', () => {
    expect(styles).toContain('.graph-canvas { width: 100%; max-width: 100%; height: 100%; min-height: 0; }');
    expect(styles).toContain('.graph-canvas--ecology { min-height: 0; }');
  });

  it('keeps model-suggested relationship wording wrapped and fully editable', () => {
    expect(styles).toMatch(/\.relationship-verb-editor\s*\{[^}]*min-height:\s*var\(--control-height\);/s);
    expect(styles).toMatch(/\.relationship-verb-editor\s*\{[^}]*overflow:\s*hidden;[^}]*resize:\s*vertical;/s);
    expect(styles).toMatch(/\.relationship-verb-editor\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/s);
    expect(styles).toMatch(/@media \(max-width: 600px\)[\s\S]*\.relationship-verb-editor\s*\{?[^}]*font-size:\s*16px;/);
  });
});
