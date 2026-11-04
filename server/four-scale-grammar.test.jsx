// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { createDefaultProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { memoResponseSchema } from '../shared/memo-response-schema.js';
const origin = 'http://127.0.0.1:4177', systems = [];
afterEach(async () => { for (const system of systems.splice(0)) await system.close(); });
const carried = [
  { id: 'resident', label: 'Resident', type: 'person', scale: 'micro' },
  { id: 'teacher', label: 'Teacher', type: 'role', scale: 'micro' },
  { id: 'housing-office', label: 'City Housing Authority', type: 'agency', scale: 'exosphere' },
  { id: 'housing-policy', label: 'Public housing funding policy', type: 'policy', scale: 'exosphere' },
];
const source = 'A resident meets a teacher. City Housing Authority administers public housing funding policy. That policy shapes housing repairs for the resident.';
const review = (scale, connections = []) => ({ guidance: [{ point: 'Check the connection to housing repairs.' }], nodes: scale === 'exosphere' ? [{ label: 'Housing repair budget', type: 'resource', scale, evidence: 'Housing repairs are shaped by the policy.', basis: 'inference' }] : [], connections, example: null, readiness: { ready: true, note: 'Review the supported items.' } });
async function setup(scale, output, connections = []) {
 const run = vi.fn(async () => ({ suggestion: output, metadata: { provider: 'cail-gateway', model: 'test-only' } }));
 const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101', ollamaConfig: { apiKey: 'test-only', model: 'test-only' }, suggestionProvider: 'cail-gateway', ollamaRequest: run }); systems.push(system); await system.ready;
 const headers = { origin, 'content-type': 'application/json' };
 const access = await system.app.request(origin + '/api/student/access', { method: 'POST', headers, body: JSON.stringify({ code: '101' }) }); headers.cookie = access.headers.get('set-cookie').split(';')[0];
 const p = createDefaultProject(); p.activeScale = scale; p.submission.text = source; p.graph.nodes = carried.map(n => ({ ...n, status: 'confirmed', claimState: 'observed' })); p.graph.edges = connections;
 return { run, evaluate: () => system.app.request(origin + '/api/preflight/evaluations', { method: 'POST', headers, body: JSON.stringify(preflightEvaluationPayload(p)) }) };
}
it('Exo proposes a larger-scale node without requiring a premature relationship', async () => {
 const output = review('exosphere'); const { evaluate, run } = await setup('exosphere', output); const response = await evaluate();
 expect(response.status).toBe(201); const { evaluation } = await response.json(); expect(evaluation.review).toEqual(output); expect(run).toHaveBeenCalledTimes(1);
 expect(run.mock.calls[0][0].systemPrompt).toContain('MACROSYSTEM HEADING CHECK');
 expect(run.mock.calls[0][0].systemPrompt).toContain('not a proper-named person, organization or office');
 const schema = memoResponseSchema('exosphere', carried); expect(schema.properties.nodes.maxItems).toBe(6); expect(schema.properties.connections.maxItems).toBe(0);
});
it('Macro accepts larger-to-larger and larger-to-local exact-ID relationships', async () => {
 const connections = [
  { source: 'housing-office', target: 'housing-policy', verb: 'administers', rationale: source, relationshipProcess: { direction: 'source to target' } },
  { source: 'housing-policy', target: 'resident', verb: 'shapes repairs for', rationale: source, relationshipProcess: { direction: 'varies' } },
 ];
 const { evaluate } = await setup('macrosphere', review('macrosphere', connections)); const response = await evaluate(); expect(response.status).toBe(201);
 const result = (await response.json()).evaluation.review; expect(result.nodes).toEqual([]); expect(result.connections.map(c => [c.source,c.target,c.verb])).toEqual(connections.map(c => [c.source,c.target,c.verb])); expect(result.connections[1].relationshipProcess.direction).toBe('varies');
 const schema = memoResponseSchema('macrosphere', carried); expect(schema.properties.nodes.maxItems).toBe(0); expect(schema.properties.connections.items.properties.source.enum).toContain('housing-office');
});
it.each(['NYC Department of Education', 'NYC Police Department', 'District Student Support Office'])('corrects the named agency heading %s without altering carried nodes', async label => {
 const output = { ...review('exosphere'), nodes: [{ label, type: 'agency', scale: 'exosphere', evidence: source, basis: 'inference' }] };
 const { evaluate, run } = await setup('exosphere', output);
 run.mockResolvedValueOnce({ suggestion: output, metadata: { provider: 'cail-gateway', model: 'test-only' } })
   .mockResolvedValueOnce({ suggestion: review('exosphere'), metadata: { provider: 'cail-gateway', model: 'test-only' } });
 const response = await evaluate(); expect(response.status).toBe(201);
 const evaluation = (await response.json()).evaluation;
 expect(evaluation.review.nodes).toEqual(review('exosphere').nodes);
 expect(evaluation.runtime.correctiveRetries).toBe(1);
 expect(run.mock.calls[1][0].systemPrompt).toContain('CORRECTIVE RETRY');
 expect(carried.find(node => node.id === 'housing-office').label).toBe('City Housing Authority');
});
it.each(['invented-node', 'City Housing Authority'])('Macro excludes unknown or label-only endpoint %s while retaining valid feedback', async bad => {
 const { evaluate } = await setup('macrosphere', review('macrosphere', [{ source: bad, target: 'resident', verb: 'affects', rationale: source }]));
 const response = await evaluate(); expect(response.status).toBe(201);
 const { evaluation } = await response.json();
 expect(evaluation.runtime).toMatchObject({ feedbackOnly: true, correctiveRetries: 1 });
 expect(evaluation.review).toMatchObject({ guidance: review('macrosphere').guidance, nodes: [], connections: [], example: null, readiness: { ready: false } });
});
it('Exo rejects edges and Macro rejects replacement node proposals', async () => {
 const exo = review('exosphere', [{ source: 'housing-office', target: 'resident', verb: 'affects', rationale: source }]);
 expect((await (await setup('exosphere', exo)).evaluate()).status).toBe(502);
 const macro = { ...review('macrosphere'), nodes: [{ label: 'Replacement policy', type: 'policy', scale: 'macrosphere', evidence: source, basis: 'memo', deontic: 'shapes', scope: ['resident','teacher'] }] };
 expect((await (await setup('macrosphere', macro)).evaluate()).status).toBe(502);
});

const localRelationship = { id: 'local-contact', source: 'resident', target: 'teacher', verb: 'meets', scale: 'meso', evidence: source };
it('Macro populates an exact local relationship group and retains manual selection context', async () => {
 const group = { source: 'housing-policy', target: 'resident', verb: 'shapes', rationale: source,
   relationshipIds: ['local-contact'], relationshipProcess: { direction: 'source to target' } };
 const { evaluate, run } = await setup('macrosphere', review('macrosphere', [group]), [localRelationship]);
 const response = await evaluate(); expect(response.status).toBe(201);
 expect((await response.json()).evaluation.review.connections[0]).toMatchObject(group);
 const prompt = run.mock.calls[0][0].systemPrompt;
 expect(prompt).toContain('TRY TO BUILD RELATIONSHIP GROUPS');
 expect(prompt).not.toContain('Return no relationship edge');
 const schema = memoResponseSchema('macrosphere', carried, undefined, [localRelationship]);
 expect(schema.properties.connections.items.properties.relationshipIds.items.enum).toEqual(['local-contact']);
});
it.each(['invented-relationship', 'housing-policy'])('Macro rejects unsupported relationship membership %s and keeps retry grammar consistent', async id => {
 const group = { source: 'housing-policy', target: 'resident', verb: 'shapes', rationale: source, relationshipIds: [id] };
 const { evaluate, run } = await setup('macrosphere', review('macrosphere', [group]), [localRelationship]);
 const response = await evaluate(); expect(response.status).toBe(201);
 const evaluation = (await response.json()).evaluation;
 expect(evaluation.review.connections).toEqual([]);
 expect(evaluation.runtime.feedbackOnly).toBe(true);
 expect(run.mock.calls[1][0].systemPrompt).toContain('For this Macro replacement, return an empty nodes array');
 expect(run.mock.calls[1][0].systemPrompt).not.toContain('connections must be an empty array');
});
