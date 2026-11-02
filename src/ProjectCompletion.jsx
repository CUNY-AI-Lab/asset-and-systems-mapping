import React, { useState } from 'react';
import { summarizeMap, isLiveMapItem } from './mapInsights.js';
import { SCALE_ORDER, SCALES } from './domain.js';

export default function ProjectCompletion({ project, onReturn, onExport, onMoreExports }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [audience, setAudience] = useState(project.sharingTier);
  const summary = summarizeMap(project);
  const nodeById = new Map(project.graph.nodes.map(node => [node.id,node]));
  const crossScale = project.graph.edges.filter(edge => isLiveMapItem(edge) && nodeById.get(edge.source)?.scale !== nodeById.get(edge.target)?.scale).length;
  const tiers = ['private','course','CUNY','public'];
  const max = tiers.indexOf(project.instructor.maxSharingTier);
  const exportFile = async format => {
    if (busy) return;
    setBusy(format); setError(''); setMessage('');
    try { await onExport(format, audience); setMessage(`${format === 'json' ? 'Private backup' : format.toUpperCase()} downloaded.`); }
    catch (cause) { setError(cause.message || 'Export failed. Try again.'); }
    finally { setBusy(''); }
  };
  return <section className="project-completion" aria-labelledby="completion-title">
    <header><h1 id="completion-title" tabIndex="-1">{project.title || 'Map'}</h1></header>
    <p className="completion-total">{summary.nodes} nodes · {summary.relationships} relationships{crossScale ? ` · ${crossScale} cross-scale ${crossScale === 1 ? 'relationship' : 'relationships'}` : ''}</p>
    <div className="completion-levels">{SCALE_ORDER.map(scale => {
      const result = summary.levels.find(level => level.scale === scale);
      const notes = scale === project.activeScale ? project.reflection : project.levelProgress?.[scale]?.reflection;
      const counted = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;
      const nodeStage = ['micro','exosphere'].includes(scale);
      const count = [
        counted(nodeStage ? result.nodes : result.relationships, nodeStage ? 'node' : 'relationship'),
        nodeStage && result.relationships ? counted(result.relationships, 'relationship') : '',
        !nodeStage && result.nodes ? counted(result.nodes, 'node') : '',
      ].filter(Boolean).join(' · ');
      return <section key={scale} aria-label={`${SCALES[scale].label} summary`}><h2>{SCALES[scale].label}</h2><p>{count}{result.scopeLinks ? ` · ${result.scopeLinks} scope links` : ''}</p>{notes?.trim() && <blockquote>{notes.length > 240 ? `${notes.slice(0,240)}…` : notes}</blockquote>}</section>;
    })}</div>
    <section className="completion-exports" aria-label="Completion exports"><h2>Export</h2>
      <label className="field"><span className="field__label">Audience</span><select value={audience} onChange={event=>setAudience(event.target.value)} disabled={Boolean(busy)}>{tiers.map((tier,index)=><option key={tier} value={tier} disabled={index>max}>{tier==='private'?'Only me':tier==='course'?'Class':tier==='public'?'Public':'CUNY'}</option>)}</select></label>
      <div className="completion-format-actions">{[['json','Private backup'],['png','PNG'],['pdf','PDF']].map(([format,label])=><button key={format} type="button" className="button button--secondary" disabled={Boolean(busy)} aria-busy={busy===format} onClick={()=>exportFile(format)}>{label}</button>)}<button type="button" className="button button--secondary" disabled={Boolean(busy)} onClick={onMoreExports}>More exports</button></div>
      <p className="sr-only" role="status">{busy ? 'Exporting…' : message}</p>{error && <p role="alert">{error}</p>}
      <div className="completion-return"><button type="button" className="button" onClick={onReturn}>Return to map</button></div>
    </section>
  </section>;
}
