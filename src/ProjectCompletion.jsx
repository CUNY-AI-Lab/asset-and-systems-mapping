import React from 'react';
import MapDownloadControls from './MapDownloadControls.jsx';
import { summarizeMap } from './mapInsights.js';
import { SCALE_ORDER, SCALES } from './domain.js';

export default function ProjectCompletion({ project, onReturn, onExport, preview }) {
  const summary = summarizeMap(project);
  const counted = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;
  return <section className="project-completion" aria-labelledby="completion-title">
    <header><h1 id="completion-title" tabIndex="-1">{project.title || 'Map'}</h1><button type="button" className="button button--secondary completion-back" onClick={onReturn}>Return to map</button></header>
    <p className="completion-total">{counted(summary.nodes, 'item')} · {counted(summary.relationships, 'connection')}</p>
    {preview}
    <section className="completion-exports" aria-label="Download your map"><h2>Download your map</h2>
      <MapDownloadControls onDownload={onExport} />
    </section>
    <div className="completion-levels">{SCALE_ORDER.map(scale => {
      const result = summary.levels.find(level => level.scale === scale);
      const notes = scale === project.activeScale ? project.reflection : project.levelProgress?.[scale]?.reflection;
      const nodeStage = ['micro','exosphere'].includes(scale);
      const count = [
        counted(nodeStage ? result.nodes : result.relationships, nodeStage ? 'item' : 'connection'),
        nodeStage && result.relationships ? counted(result.relationships, 'connection') : '',
        !nodeStage && result.nodes ? counted(result.nodes, 'item') : '',
      ].filter(Boolean).join(' · ');
      return <section key={scale} aria-label={`${SCALES[scale].label} summary`}><h2>{SCALES[scale].label}</h2><p>{count}</p>{notes?.trim() && <blockquote>{notes.length > 240 ? `${notes.slice(0,240)}…` : notes}</blockquote>}</section>;
    })}</div>
  </section>;
}
