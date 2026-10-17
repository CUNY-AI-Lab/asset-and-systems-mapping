import React from 'react';

// Presentational shell for the canvas-first Studio. Decision logic lives in
// nextStep.js; stage records stay the source of truth in App.jsx.

const SHORT = { micro: 'Micro', meso: 'Meso', exosphere: 'Exo', macrosphere: 'Macro' };

export function LevelRail({ levels, onSelect }) {
  return <nav className="level-rail" aria-label="Work level">
    <ol>{levels.map((level, index) => {
      const locked = level.state === 'locked';
      return <li key={level.scale} className={`level-rail__item is-${level.state}${level.complete ? ' is-complete' : ''}`}>
        <button type="button" disabled={locked} aria-current={level.current ? 'step' : undefined} aria-label={`${level.label}${level.complete ? ', complete' : level.current ? ', current' : locked ? ', not started' : ''}`} onClick={() => onSelect?.(level.scale)}>
          <span className="level-rail__mark" aria-hidden="true">{level.complete ? '✓' : index + 1}</span>
          <span className="level-rail__label">{SHORT[level.scale] || level.label}</span>
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
  return <div className="inspector-tabs work-panel__tabs" role="tablist" aria-label="Work panel">
    {PANEL_TABS.map((tab) => <button key={tab.id} id={`work-panel-tab-${tab.id}`} type="button" role="tab" aria-selected={mode === tab.id} aria-controls="map-inspector" tabIndex={mode === tab.id ? 0 : -1} data-composite-value={tab.id} disabled={disabled.includes(tab.id)} onClick={() => onChange?.(tab.id)} onKeyDown={onKeyDown}>{tab.label}</button>)}
  </div>;
}
