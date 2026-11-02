import React, { useState } from 'react';

export function Action({ as: Element = 'button', variant = 'primary', className = '', children, ...props }) {
  return <Element className={`button studio-action button--${variant} ${className}`} {...(Element === 'button' ? { type: 'button' } : {})} {...props}>{children}</Element>;
}

export function PageHeading({ title, description, actions, children, className = '' }) {
  return <header className={`studio-heading ${className}`}><div><h1>{title}</h1>{description && <p className="lede">{description}</p>}{children}</div>{actions && <div className="studio-heading__actions">{actions}</div>}</header>;
}

export function Disclosure({ title, children, className = '', defaultOpen = false, ...props }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  return <details className={`studio-disclosure ${className}`} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} {...props}><summary>{title}</summary><div className="studio-disclosure__body">{children}</div></details>;
}

const LEVELS = [{ id: 'micro', label: 'Micro' }, { id: 'meso', label: 'Meso' }, { id: 'exosphere', label: 'Exo' }, { id: 'macrosphere', label: 'Macro' }];

export function LevelTrail({ active = 'micro', completed = [] }) {
  return <ol className="studio-levels" aria-label="Map levels">{LEVELS.map(({ id, label }, index) => <li key={id} aria-current={id === active ? 'step' : undefined} className={`${id === active ? 'is-current' : ''} ${completed.includes(id) ? 'is-complete' : ''}`}><span className="studio-levels__number" aria-hidden="true">{completed.includes(id) ? '✓' : index + 1}</span><span>{label}</span><span className="sr-only">{completed.includes(id) ? ' completed' : id === active ? ' current' : ''}</span></li>)}</ol>;
}

export function ProjectRow({ title, current, subtitle, detail, onOpen, actions, disabled, openLabel = 'Open' }) {
  return <article className={`studio-project ${current ? 'is-current' : ''}`} aria-label={title}><div className="studio-project__copy"><h2><button type="button" className="project-title" disabled={disabled} onClick={onOpen} aria-label="Open project">{title}</button></h2>{subtitle && <p>{subtitle}</p>}{detail && <p className="studio-project__detail">{detail}</p>}</div>{actions && <div className="studio-project__actions">{actions}</div>}</article>;
}

export function EmptyState({ title, description, action }) {
  return <section className="studio-empty"><h2>{title}</h2>{description && <p>{description}</p>}{action}</section>;
}

export function ReviewPager({ index, total, onPrevious, onNext, kind = 'Item' }) {
  return <nav className="studio-review-pager" aria-label="Suggestions"><span role="status">{kind} {index + 1} of {total}</span><div><Action variant="ghost" disabled={index === 0} onClick={onPrevious}>Previous</Action><Action variant="secondary" disabled={index >= total - 1} onClick={onNext}>Next</Action></div></nav>;
}
