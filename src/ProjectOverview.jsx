import React, { useMemo } from 'react';
import { summarizeMap } from './mapInsights.js';
import { systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';

const counted = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

export default function ProjectOverview({ project, onReviewLevel }) {
  const summary = useMemo(() => summarizeMap(project), [project.graph, project.candidates]);
  return <details className="project-overview">
    <summary><strong>Cumulative map</strong><span>{counted(summary.nodes, 'element')} · {counted(summary.crossLevelLinks, 'link')} across levels</span></summary>
    <div className="project-overview__body">
      <p>Each level builds on earlier work. Review the evidence and open questions before drawing conclusions.</p>
      <div className="project-overview__levels">
        {summary.levels.filter((level) => project.releasedScales.includes(level.scale)).map((level) => {
          const reflection = level.scale === project.activeScale ? project.reflection : project.levelProgress?.[level.scale]?.reflection;
          const resultLabel = level.scale === 'meso' ? 'mesosystem' : level.scale === 'macrosphere' ? 'broader condition' : 'element';
          const linkLabel = level.scale === 'meso' ? 'setting link' : level.scale === 'macrosphere' ? 'scope link' : 'relationship';
          const linkCount = ['meso', 'macrosphere'].includes(level.scale) ? level.scopeLinks : level.relationships;
          return <section key={level.scale} aria-label={`${systemsMappingLevelTitle(level.scale)} results`}>
            <div className="project-overview__level-heading"><h3>{systemsMappingLevelTitle(level.scale)}</h3>
              {onReviewLevel && <button type="button" onClick={() => onReviewLevel(level.scale)}>Review<span className="sr-only"> {systemsMappingLevelTitle(level.scale)}</span></button>}
            </div>
            <p>{counted(level.nodes, resultLabel)} · {counted(linkCount, linkLabel)}</p>
            <p className="project-overview__review">{level.evidenceToReview} {level.evidenceToReview === 1 ? 'item' : 'items'} to check for evidence{level.setAside ? ` · ${level.setAside} set aside` : ''}</p>
            {reflection && <details><summary>Revision note</summary><p className="project-overview__reflection">{reflection}</p></details>}
          </section>;
        })}
      </div>
    </div>
  </details>;
}
