import React, { useMemo, useState } from 'react';
import { Action, ProjectRow } from './ui/StudioPrimitives.jsx';
import { SCALES, SCALE_ORDER } from './domain.js';
import { progressDetail, progressLabel } from './projectProgress.js';

export default function SavedProjects({ records, busy, onOpen, onInspect, onDelete }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [level, setLevel] = useState('all');
  const shown = useMemo(() => records.filter(record => record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (level === 'all' || (record.progress?.activeScale || record.activeScale) === level)).toSorted((a, b) => sort === 'name' ? a.title.localeCompare(b.title) || a.id.localeCompare(b.id) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)), [records, query, sort, level]);
  return <section className="saved-projects" aria-label="Saved projects">
    <div className="project-list-controls">
      <label className="field"><span className="sr-only">Find projects</span><input type="search" aria-label="Find projects" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="field"><span className="sr-only">Project order</span><select aria-label="Project order" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">Recently updated</option><option value="name">Name</option></select></label>
      <label className="field"><span className="sr-only">Project level</span><select aria-label="Project level" value={level} onChange={event => setLevel(event.target.value)}><option value="all">All levels</option>{SCALE_ORDER.map(scale => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}</select></label>
    </div>
    <div className="studio-projects">{shown.map(record => <ProjectRow key={record.id} title={record.title || 'Untitled systems map'} subtitle={progressLabel(record)} detail={[record.localOnly ? 'Device copy' : '', progressDetail(record), `Updated ${new Date(record.updatedAt).toLocaleDateString()}`].filter(Boolean).join(' · ')} disabled={busy} onOpen={() => onOpen(record)} actions={<>
      <Action variant="ghost" disabled={busy} onClick={() => onInspect(record, 'notes')}>Notes</Action>
      <Action variant="ghost" disabled={busy} onClick={() => onInspect(record, 'export')}>Export</Action>
      <Action variant="ghost" disabled={busy} onClick={() => onDelete(record)}>Delete</Action>
    </>} />)}</div>
    {!shown.length && <p role="status">No matching projects.</p>}
  </section>;
}
