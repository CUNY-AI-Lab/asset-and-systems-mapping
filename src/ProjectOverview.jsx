import React, { useMemo } from 'react';
import { summarizeMap } from './mapInsights.js';
import { systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';

const counted = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

export default function ProjectOverview({ project, onReviewLevel }) {
  const summary = useMemo(() => summarizeMap(project), [project.graph, project.candidates]);
  return <details className="project-overview">
    <summary><strong>Cumulative map</strong><span>{counted(summary.nodes, 'element')} · {counted(summary.crossLevelLinks, 'link')} across levels</span></summary>
    <div className="project-overview__body">
      <div className="project-overview__levels">
        {summary.levels.filter((level) => project.releasedScales.includes(level.scale)).map((level) => {
          const reflection = level.scale === project.activeScale ? project.reflection : project.levelProgress?.[level.scale]?.reflection;
          const resultLabel = level.scale === 'macrosphere' ? 'broader condition' : 'element';
          const linkLabel = level.scale === 'macrosphere' ? 'scope link' : 'relationship';
          const linkCount = level.scale === 'macrosphere' ? level.scopeLinks : level.relationships;
          const mapResults = level.scale === 'meso'
            ? [counted(level.relationships, 'relationship'), level.nodes ? counted(level.nodes, 'saved linkage') : ''].filter(Boolean).join(' · ')
            : level.scale === 'micro'
              ? counted(level.nodes, 'element')
              : `${counted(level.nodes, resultLabel)} · ${counted(linkCount, linkLabel)}`;
          const reviewSummary = [
            level.evidenceToReview ? `${counted(level.evidenceToReview, 'item')} to review` : '',
            level.setAside ? `${counted(level.setAside, 'item')} set aside` : '',
          ].filter(Boolean).join(' · ');
          return <section key={level.scale} aria-label={`${systemsMappingLevelTitle(level.scale)} results`}>
            <div className="project-overview__level-heading"><h3>{systemsMappingLevelTitle(level.scale)}</h3>
              {onReviewLevel && <button type="button" onClick={() => onReviewLevel(level.scale)}>Review<span className="sr-only"> {systemsMappingLevelTitle(level.scale)}</span></button>}
            </div>
            <p>{mapResults}</p>
            {reviewSummary && <p className="project-overview__review">{reviewSummary}</p>}
            {reflection && <details><summary>Field Notes</summary><p className="project-overview__reflection">{reflection}</p></details>}
          </section>;
        })}
      </div>
    </div>
  </details>;
}
