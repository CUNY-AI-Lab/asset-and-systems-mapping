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
  return <section className="course-students" aria-labelledby="course-students-title">
    <div className="review-column-heading"><h2 id="course-students-title">Students and saved progress</h2><button type="button" className="button button--ghost" disabled={busy} onClick={() => load()}>Refresh students</button></div>
    <p>Students appear after signing into Systems Mapping. Progress reflects their saved course maps. Submitted revision counts begin when students use Submit revision in Progress; autosaves and generation attempts stay separate.</p>
    <p className="field__hint">Updates every 30 seconds while open. Private maps and Field Notes are not shown here.</p>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Loading student progress…</p>}
    {!busy && !error && !students.length && !demonstrations.length && <p>Students will appear here after their first sign-in.</p>}
    {[...demonstrations, ...students].map(student => <article key={student.memberId} className="course-student">
      <h3>{student.displayName || 'Student — name unavailable'}</h3>
      {student.demonstration ? <p>Demonstration data · illustrative progress and revision counts</p> : <p>First signed in {new Date(student.firstSeen).toLocaleString()}</p>}
      {student.projects.length ? <ul>{student.projects.map(project => <li key={project.id}>
        <strong>{project.title || 'Untitled systems map'}</strong><p>{student.demonstration ? 'Example map' : `Saved ${new Date(project.updatedAt).toLocaleString()}`} · Revision {project.revision}</p>
        {project.submittedRevisions?.length ? <details><summary>Submitted revisions by level and stage</summary><ul>{project.submittedRevisions.map(entry => <li key={`${entry.scale}-${entry.stage}`}>{levelNames[entry.scale]} · {SYSTEMS_MAPPING_STAGES[entry.stage]?.label}: {entry.count} submitted {entry.count === 1 ? 'revision' : 'revisions'}</li>)}</ul></details> : <p>Submitted revisions: 0</p>}
        <ul>{project.levels.map(level => <li key={level.scale}>{levelNames[level.scale]}: {level.completed ? 'Completed' : level.started ? SYSTEMS_MAPPING_STAGES[level.stage]?.label || 'In progress' : 'Upcoming'}</li>)}</ul>
      </li>)}</ul> : <p>Signed in · First course map pending</p>}
      {student.projectCount > student.projects.length && <p>Showing the latest {student.projects.length} of {student.projectCount} saved maps.</p>}
    </article>)}
    {nextCursor && <button type="button" className="button button--ghost" disabled={busy} onClick={() => load(nextCursor)}>More students</button>}
  </section>;
}
