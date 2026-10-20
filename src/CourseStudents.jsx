import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from './api.js';
import { userFacingError } from './userFacingError.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import { useVisibleRefresh } from './useVisibleRefresh.js';

const levelNames = { micro: 'Micro', meso: 'Meso', exosphere: 'Exo', macrosphere: 'Macro' };

export default function CourseStudents({ active = true }) {
  const [students, setStudents] = useState([]);
  const [demonstrations, setDemonstrations] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = async (cursor) => {
    const current = ++generation.current;
    setBusy(true); setError('');
    // A refresh clears previously authorized roster content while rechecking access.
    if (!cursor) { setStudents([]); setDemonstrations([]); setNextCursor(null); }
    try {
      const page = await apiRequest('/api/cloud/course-students' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
      if (current !== generation.current) return;
      setStudents(previous => cursor ? [...new Map([...previous, ...page.students].map(student => [student.memberId, student])).values()] : page.students);
      setDemonstrations(page.demonstrationStudents || []);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (current !== generation.current) return;
      setStudents([]); setDemonstrations([]); setNextCursor(null);
      setError(userFacingError(failure, 'Student progress is temporarily unavailable. Refresh to check again.'));
    } finally { if (current === generation.current) setBusy(false); }
  };
  useEffect(() => { if (active) void load(); return () => { generation.current++; }; }, [active]);
  useVisibleRefresh(() => { if (!busy) void load(); }, active);
  return <section className="course-students" aria-label="Saved progress">
    <div className="course-students__toolbar">
      <p className="field__hint">Updates every 30 seconds while open. Map contents and Field Notes aren’t shown here.</p>
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => load()}>Refresh progress</button>
    </div>
    {error && <p className="teacher-message teacher-message--error" role="alert">{error}</p>}
    {busy && <p className="console-empty" role="status">Loading progress…</p>}
    {!busy && !error && !students.length && !demonstrations.length && <p className="console-empty">Students appear after their first sign-in.</p>}
    {[...demonstrations, ...students].map(student => <article key={student.memberId} className="course-student">
      <header className="course-student__heading">
        <h3>{student.displayName || 'Name unavailable'}</h3>
        <p>{student.demonstration ? 'Example progress' : `First sign-in ${new Date(student.firstSeen).toLocaleString()}`}</p>
      </header>
      {student.projects.length ? <ul className="course-student__projects">{student.projects.map(project => <li key={project.id}>
        <div className="course-student__map-heading">
          <h4>{project.title || 'Untitled map'}</h4>
          <p>{student.demonstration ? 'Example map' : `Saved ${new Date(project.updatedAt).toLocaleString()}`} · Revision {project.revision}</p>
        </div>
        <ul className="course-student__levels" aria-label="Progress by scale">{project.levels.map(level => <li key={level.scale}>
          <span>{levelNames[level.scale]}</span>
          <strong>{level.completed ? 'Completed' : level.started ? SYSTEMS_MAPPING_STAGES[level.stage]?.label || 'In progress' : 'Upcoming'}</strong>
        </li>)}</ul>
        {project.submittedRevisions?.length ? <details className="course-student__revisions"><summary>Submitted revisions</summary>
          <p className="field__hint">Counts increase when a student submits a revision.</p>
          <ul>{project.submittedRevisions.map(entry => <li key={`${entry.scale}-${entry.stage}`}><span>{levelNames[entry.scale]} · {SYSTEMS_MAPPING_STAGES[entry.stage]?.label}</span><strong>{entry.count} {entry.count === 1 ? 'revision' : 'revisions'}</strong></li>)}</ul>
        </details> : <p className="course-student__meta">No submitted revisions</p>}
      </li>)}</ul> : <p className="course-student__meta">No saved maps yet.</p>}
      {student.projectCount > student.projects.length && <p className="course-student__meta">Latest {student.projects.length} of {student.projectCount} saved maps</p>}
    </article>)}
    {nextCursor && <button type="button" className="button button--ghost" disabled={busy} onClick={() => load(nextCursor)}>More students</button>}
  </section>;
}
