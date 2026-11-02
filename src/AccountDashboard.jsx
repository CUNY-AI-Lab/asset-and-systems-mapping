import React, { lazy, Suspense, useRef, useState } from 'react';
import { Action, PageHeading } from './ui/StudioPrimitives.jsx';
import { courseWorkspacePath, instructorWorkspacePath } from './courseContext.js';
import CoursePromptEditor from './CoursePromptEditor.jsx';

const TeacherDashboard = lazy(() => import('./TeacherDashboard.jsx'));

export default function AccountDashboard({ account, courses, courseError, quota, tab, onTab, onReturn, returnLabel, request, active, onConfigurationChanged }) {
  const instructor = account.role === 'instructor';
  const [visitedInstructor, setVisitedInstructor] = useState(tab === 'instructor' && instructor);
  const tabs = instructor ? ['overview', 'instructor'] : ['overview'];
  const selected = instructor && tab === 'instructor' ? 'instructor' : 'overview';
  const refs = useRef(new Map());
  const choose = next => { if (next === 'instructor') setVisitedInstructor(true); onTab(next); };
  const move = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    choose(tabs[next]); refs.current.get(tabs[next])?.focus();
  };
  const remaining = quota?.remaining_percent;
  const usage = typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0 && remaining <= 100 ? `Approximately ${remaining}% remaining` : 'Unavailable';
  const role = account.course?.guestInstructor ? 'Guest instructor' : instructor ? 'Instructor' : 'Student';
  return <section className="account-dashboard" aria-label="Account dashboard">
    <PageHeading title="Account" actions={<Action variant="secondary" onClick={onReturn}>{returnLabel}</Action>} />
    <div className="account-tabs" role="tablist" aria-label="Account">
      {tabs.map((value, index) => <button key={value} ref={node => node ? refs.current.set(value, node) : refs.current.delete(value)} id={`account-tab-${value}`} type="button" role="tab" aria-selected={selected === value} aria-controls={`account-panel-${value}`} tabIndex={selected === value ? 0 : -1} onKeyDown={event => move(event, index)} onClick={() => choose(value)}>{value === 'overview' ? 'Overview' : 'Instructor Console'}</button>)}
    </div>
    <div id="account-panel-overview" role="tabpanel" aria-labelledby="account-tab-overview" hidden={selected !== 'overview'}>
      <div className="account-grid">
        <section className="account-card" aria-labelledby="account-profile"><h2 id="account-profile">Profile</h2>
          <dl><dt>Preferred name</dt><dd>{account.preferredName || 'Unavailable'}</dd><dt>Email</dt><dd>{account.email || 'Unavailable'}</dd><dt>Access</dt><dd>{role}</dd></dl>
          <form action="/auth/logout" method="post"><Action variant="ghost" type="submit">Sign out</Action></form>
        </section>
        <section className="account-card" aria-labelledby="account-usage"><h2 id="account-usage">Model usage</h2><p>{usage}</p></section>
        <section className="account-card account-card--wide" aria-labelledby="account-materials"><h2 id="account-materials">Classes and materials</h2>
          {account.course ? <p>{[account.course.name, account.course.term, account.course.section].filter(Boolean).join(' · ')}</p> : courses.length ? <ul className="account-courses">{courses.map(course => <li key={course.id}>
            <div className="account-course-info"><a href={courseWorkspacePath('/', { kind: 'course', id: course.id })}>{course.name}</a><span>{[course.term, course.section].filter(Boolean).join(' · ')}</span></div>
            {course.role === 'instructor' && <><span>{course.guestInstructor ? 'Guest instructor' : 'Instructor'}</span><a href={instructorWorkspacePath({ kind: 'course', id: course.id })} aria-label={`Instructor Console for ${course.name} · ${course.term} · ${course.section}`}>Instructor Console</a></>}
          </li>)}</ul> : <p>No classes available.</p>}
          {courseError && <p role="status">{courseError}</p>}
          <p className="account-muted">Shared files are not available in this workspace.</p>
        </section>
      </div>
      <nav className="account-resources" aria-label="CUNY AI Lab resources"><a href="https://ailab.gc.cuny.edu">CUNY AI Lab</a><a href="https://ailab.gc.cuny.edu/request-access/">Request access</a><a href="mailto:ailab@gc.cuny.edu">Contact</a></nav>
    </div>
    {instructor && (visitedInstructor || selected === 'instructor') && <div id="account-panel-instructor" role="tabpanel" aria-labelledby="account-tab-instructor" hidden={selected !== 'instructor'}>
      {account.course?.guestInstructor && <p className="account-role">Guest instructor · {account.course.name}</p>}
      {account.course && <CoursePromptEditor course={account.course} request={request} onSaved={onConfigurationChanged} />}
      <Suspense fallback={<p role="status">Opening Instructor Console…</p>}><TeacherDashboard institutionalMode embedded active={active && selected === 'instructor'} onConfigurationChanged={onConfigurationChanged} /></Suspense>
    </div>}
  </section>;
}
