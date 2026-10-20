import React, { useEffect, useRef } from 'react';

// Presentational shell for the canvas-first Studio. Decision logic lives in
// nextStep.js; stage records stay the source of truth in App.jsx.

const SHORT = { micro: 'Micro', meso: 'Meso', exosphere: 'Exo', macrosphere: 'Macro' };

export function ProjectMenu({ children }) {
  const menu = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <details ref={menu} className="project-menu" onClick={(event) => {
    const button = event.target.closest('button');
    if (button?.parentElement === event.currentTarget.querySelector(':scope > div')) event.currentTarget.open = false;
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.open = false;
      event.currentTarget.querySelector('summary')?.focus();
    }
  }}><summary>Project</summary><div>{children}</div></details>;
}

export function LevelSelect({ levels, onSelect }) {
  return <label className="notebook-level"><span className="sr-only">Work level</span>
    <select value={levels.find((level) => level.current)?.scale} onChange={(event) => onSelect(event.target.value)}>
      {levels.map((level) => <option key={level.scale} value={level.scale} disabled={level.state === 'locked'}>{SHORT[level.scale]}{level.complete ? ' · complete' : ''}</option>)}
    </select>
  </label>;
}

export function NotebookSection({ mode, onChange, disabled = [] }) {
  return <label className="notebook-section"><span className="sr-only">Notebook section</span>
    <select value={mode} onChange={(event) => onChange(event.target.value)}>
      <option value="suggestions">Memo and suggestions</option>
      <option value="review" disabled={disabled.includes('review')}>Field Notes</option>
    </select>
  </label>;
}

export function LevelRail({ levels, onSelect }) {
  return <nav className="level-rail" aria-label="Work level">
    <ol>{levels.map((level, index) => {
      const locked = level.state === 'locked';
      return <li key={level.scale} className={`level-rail__item is-${level.state}${level.complete ? ' is-complete' : ''}`}>
        <button type="button" disabled={locked} aria-current={level.current ? 'step' : undefined} title={level.complete ? `${level.label} complete` : locked ? `${level.label} not started` : level.label} data-state={level.state} onClick={() => onSelect?.(level.scale)}>
          <span className="level-rail__mark" aria-hidden="true">{level.complete ? '✓' : index + 1}</span>
          <span className="level-rail__label">{SHORT[level.scale] || level.label}</span><span className="sr-only">-level</span>
        </button>
      </li>;
    })}</ol>
  </nav>;
}

export const PANEL_TABS = Object.freeze([
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'review', label: 'Review' },
]);

export function WorkPanelTabs({ mode, onChange, disabled = [], onKeyDown }) {
  return <div className="work-panel__tabs" role="tablist" aria-label="Work panel">
    {PANEL_TABS.map((tab) => <button key={tab.id} id={`work-panel-tab-${tab.id}`} type="button" role="tab" aria-selected={mode === tab.id} aria-controls="map-inspector" tabIndex={mode === tab.id ? 0 : -1} data-composite-value={tab.id} disabled={disabled.includes(tab.id)} onClick={() => onChange?.(tab.id)} onKeyDown={onKeyDown}>{tab.label}</button>)}
  </div>;
}
