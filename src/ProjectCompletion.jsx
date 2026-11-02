import React, { useState } from 'react';
import { summarizeMap } from './mapInsights.js';
import { SCALE_ORDER, SCALES } from './domain.js';

export default function ProjectCompletion({ project, onReturn, onExport, onMoreExports }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const summary = summarizeMap(project);
  const counted = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;
  const exportFile = async format => {
    if (busy) return;
    setBusy(format); setError(''); setMessage('');
    try { await onExport(format); setMessage(`${format === 'json' ? 'Private backup' : format.toUpperCase()} downloaded.`); }
    catch (cause) { setError(cause.message || 'Export failed. Try again.'); }
    finally { setBusy(''); }
  };
  return <section className="project-completion" aria-labelledby="completion-title">
    <header><h1 id="completion-title" tabIndex="-1">{project.title || 'Map'}</h1></header>
    <p className="completion-total">{counted(summary.nodes, 'item')} · {counted(summary.relationships, 'connection')}</p>
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
    <section className="completion-exports" aria-label="Download your map"><h2>Download your map</h2>
      <div className="completion-format-actions">{[['png','Download PNG'],['pdf','Download PDF'],['json','Private backup']].map(([format,label])=><button key={format} type="button" className="button button--secondary" disabled={Boolean(busy)} aria-busy={busy===format} onClick={()=>exportFile(format)}>{label}</button>)}<button type="button" className="button button--secondary" disabled={Boolean(busy)} onClick={onMoreExports}>More options</button></div>
      <p className="sr-only" role="status">{busy ? 'Exporting…' : message}</p>{error && <p role="alert">{error}</p>}
      <div className="completion-return"><button type="button" className="button" onClick={onReturn}>Return to map</button></div>
    </section>
  </section>;
}
