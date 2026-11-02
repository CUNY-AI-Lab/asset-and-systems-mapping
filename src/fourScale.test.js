import { expect, it } from 'vitest';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { createPortableProject, parseProject, serializeProject, PROJECT_SCHEMA_VERSION } from './domain.js';
import { preflightEvaluationPayload } from './App.jsx';
it('opens schema 8 without reclassifying, retiring, reorienting or dropping prior work', () => {
 const p = buildEastHarlemDisabilityProject(); p.schemaVersion = 8;
 p.levelProgress.micro.reflection = 'Lots of schools and organizations: genuine synthetic note.';
 p.graph.nodes.find(n => n.scale === 'exosphere').label = 'Historic public housing underinvestment';
 p.graph.edges.forEach(e => { e.sourceLabel = p.graph.nodes.find(n=>n.id===e.source).label; e.targetLabel=p.graph.nodes.find(n=>n.id===e.target).label; });
 const original = structuredClone(p);
 const restored = parseProject(JSON.stringify(p));
 expect(restored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
 expect(restored.graph).toEqual(original.graph); expect(restored.candidates).toEqual(original.candidates);
 expect(restored.levelProgress).toEqual(original.levelProgress); expect(restored.submission).toEqual(original.submission);
 const { exportedAt, ...again } = parseProject(serializeProject(restored)); expect(exportedAt).toBeTruthy(); expect(again).toEqual(restored);
});
it('stores blank and freely worded cross-scale Macro edges and carries earlier nodes, links and notes into the next review', () => {
 const p = buildEastHarlemDisabilityProject(); p.activeScale = 'macrosphere';
 const source = p.graph.nodes.find(n=>n.scale==='exosphere'), target=p.graph.nodes.find(n=>n.scale==='micro'&&n.type==='person');
 const edge = { ...structuredClone(p.graph.edges[0]), id:'macro-cross-scale', scale:'macrosphere', source:source.id,target:target.id,sourceLabel:source.label,targetLabel:target.label,verb:'',annotation:{id:'macro-cross-scale-annotation',text:'Student interpretation'},relationshipProcess:{direction:'varies'} };
 p.graph.edges.push(edge); p.levelProgress.exosphere.reflection='Investigate how this budget reaches local people.';
 const restored=parseProject(serializeProject(p));expect(restored.graph).toEqual(p.graph);
 const payload=preflightEvaluationPayload(restored);expect(payload.carriedNodes.map(n=>n.id)).toEqual(p.graph.nodes.map(n=>n.id));
 expect(payload.carriedConnections.find(e=>e.source===source.id&&e.target===target.id)).toMatchObject({verb:'',relationshipProcess:{direction:'varies'}});
 expect(payload.fieldNotes.text).toBe(p.levelProgress.exosphere.reflection);
 const backup=parseProject(JSON.stringify(createPortableProject(restored,'private')));expect(backup.graph.edges.find(e=>e.id===edge.id)).toEqual(edge);expect(backup.levelProgress).toEqual(restored.levelProgress);
});
