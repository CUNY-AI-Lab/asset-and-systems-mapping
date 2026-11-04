// @vitest-environment node
// Opt-in paid acceptance only. Obtain approval for the memo data and provider
// destination before setting the flag. Instructor PDFs never enter the repo.
import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { createSystemsMappingApp } from '../server/app.js';
import { createDefaultProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { beginPart2 } from '../src/projectMemo.js';
import { gatewaySuggestion, safeGatewayFailure } from './gateway.js';
import { STRONG_MACRO_MEMO, WEAK_MACRO_MEMO, FLUSHING_MACRO_MEMO, HOUSING_MACRO_MEMO } from '../tests/fixtures/two-memo-cases.js';

const HELPER = 'http://127.0.0.1:8796', ORIGIN = 'http://127.0.0.1:4177';
const MODEL = 'gpt-oss-120b';
const enabled = process.env.SYSTEMS_MAPPING_LIVE_TWO_MEMOS === '1';
const cases = [
  { id: 'strong-meso', file: /Layer_2_Mesosystem_Table_Template.*\.pdf$/, scale: 'meso' },
  { id: 'flushing-micro', file: /Assignment 2 Layer 1.*Microsystem\.pdf$/, scale: 'micro' },
  { id: 'bronx-micro', file: /^Micro Memo\.pdf$/, scale: 'micro' },
  { id: 'weaker-housing-micro', file: /^Microsystem EDITED\.pdf\.pdf$/, scale: 'micro' },
];
function memo(file) {
  const directory = process.env.SYSTEMS_MAPPING_REAL_MEMOS_DIR;
  if (!directory) throw new Error('Set the directory of the approved instructor memo examples.');
  const matches = readdirSync(directory).filter(name => file.test(name));
  if (matches.length !== 1) throw new Error('Expected exactly one local example for this case.');
  return execFileSync('pdftotext', ['-layout', join(directory, matches[0]), '-'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function projectFor(text, labels = []) {
  const project = createDefaultProject(); project.submission.text = text;
  project.graph.nodes = labels.map((label, index) => ({ id: `local-${index}`, label, type: 'role', scale: 'micro', status: 'confirmed', claimState: 'observed' }));
  project.graph.edges = []; project.candidates = { nodes: [], edges: [] };
  return project;
}

async function withLiveReview(caseId, work) {
  const minted = await fetch(HELPER + '/mint', { method: 'POST', signal: AbortSignal.timeout(15000) });
  expect(minted.status).toBe(200);
  const issued = await minted.json();
  expect(Boolean(issued.ok && issued.key && issued.credential)).toBe(true);
  const correlation = correlationFromHeaders(new Headers());
  const reports = []; let calls = 0;
  const binding = { fetch: async request => {
    const headers = new Headers(request.headers); headers.delete('x-cail-identity-jwt');
    headers.set('authorization', `Bearer ${issued.key}`); calls++;
    return fetch(new Request(request, { headers }));
  } };
  const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
    ollamaConfig: { apiKey: 'temporary-acceptance-principal', model: MODEL }, suggestionProvider: 'cail-gateway',
    suggestionFailure: error => safeGatewayFailure(error, correlation.request_id),
    ollamaRequest: (input, config, options) => gatewaySuggestion(binding, 'acceptance-test-boundary', MODEL, correlation, undefined, [])(input, config, { ...options, timeoutMs: 85000 }),
  });
  try {
    await system.ready;
    const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '101' }) });
    expect(access.status).toBe(201);
    const cookie = access.headers.get('set-cookie').split(';')[0];
    const evaluate = async project => {
      const started = Date.now();
      const response = await system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie }, body: JSON.stringify(preflightEvaluationPayload(project)),
        signal: AbortSignal.timeout(90000),
      }, { verifiedAccount: { studentSession: { sessionRef: 'two-memo-acceptance', expiresAt: Date.now() + 600000 }, guidanceTimeoutMs: 85000 } });
      const result = await response.json();
      reports.push({ scale: project.activeScale, status: response.status, elapsedMs: Date.now() - started, review: result.evaluation?.review, runtime: result.evaluation?.runtime, failureCode: result.details?.code });
      console.log(JSON.stringify({ caseId, scale: project.activeScale, status: response.status, elapsedMs: Date.now() - started, calls,
        nodes: result.evaluation?.review?.nodes?.length, connections: result.evaluation?.review?.connections?.length,
        groups: result.evaluation?.review?.connections?.filter(edge => edge.relationshipIds?.length).length }));
      expect(response.status).toBe(201);
      expect(result.evaluation.runtime.model).toBe(MODEL);
      expect(result.evaluation.review.guidance.length).toBeGreaterThan(0);
      return result.evaluation.review;
    };
    await work(evaluate);
  } finally {
    await system.close();
    try {
      const revoked = await fetch(HELPER + '/revoke', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: issued.credential.id, subject: issued.credential.subject }), signal: AbortSignal.timeout(15000) });
      expect(revoked.status).toBe(200); expect((await revoked.json()).ok).toBe(true);
    } finally {
      if (process.env.SYSTEMS_MAPPING_LIVE_OUTPUT_DIR) writeFileSync(join(process.env.SYSTEMS_MAPPING_LIVE_OUTPUT_DIR, `${caseId}.json`), JSON.stringify({ caseId, model: MODEL, calls, reports }, null, 2));
    }
  }
}

describe.skipIf(!enabled)('approved instructor examples through the real Gateway provider', () => {
  for (const fixture of cases) test(fixture.id, () => withLiveReview(fixture.id, async evaluate => {
    const project = projectFor(memo(fixture.file), fixture.scale === 'meso' ? ['Classroom teachers', 'Guidance counselors', 'Parents', 'The Door counselors'] : []);
    project.activeScale = fixture.scale;
    const review = await evaluate(project);
    if (fixture.scale === 'micro') { expect(review.nodes.length).toBeGreaterThan(0); expect(review.connections).toEqual([]); }
    else {
      expect(review.nodes).toEqual([]); expect(review.connections.length).toBeGreaterThan(0);
      expect(review.connections.some(edge => edge.relationshipProcess?.connectionStatus === 'missing')).toBe(true);
      expect(review.connections.some(edge => edge.relationshipProcess?.familyCount === 14232)).toBe(false);
    }
  }), 120000);

  const continuations = [
    ['bronx-continuation', cases[2].file, STRONG_MACRO_MEMO, ['Classroom teachers', 'Guidance counselors', 'Parents', 'The Door counselors'], [[0, 1, 'send concerns to'], [1, 2, 'contact about support'], [3, 1, 'exchange case information with']]],
    ['flushing-continuation', cases[1].file, FLUSHING_MACRO_MEMO, ['P.S. 020 teachers', 'J.H.S. 185 teachers', 'Caregivers', 'After-school instructors'], [[0, 3, 'exchange homework information with'], [3, 2, 'send program schedules to']]],
    ['housing-continuation', cases[3].file, HOUSING_MACRO_MEMO, ['Johnson Houses residents', 'Resident association representatives', 'Maintenance staff'], [[0, 1, 'report heat failures to'], [1, 2, 'pass repair requests to']]],
  ];
  for (const [id, file, continuation, labels, pairs] of continuations) test(id, () => withLiveReview(id, async evaluate => {
    const project = projectFor(memo(file), labels);
    project.graph.edges = pairs.map(([source, target, verb], index) => ({ id: `local-edge-${index}`, source: `local-${source}`, target: `local-${target}`, verb, scale: 'meso', status: 'confirmed', evidence: continuation,
      ...(id === 'bronx-continuation' && index === 2 ? { relationshipProcess: { connectionStatus: 'missing', direction: 'not yet known' } } : {}) }));
    const original = structuredClone(project.graph);
    beginPart2(project); project.part2Submission.text = continuation; project.activeScale = 'exosphere';
    const exo = await evaluate(project);
    expect(exo.nodes.length).toBeGreaterThan(0); expect(exo.connections).toEqual([]);
    project.graph.nodes.push(...exo.nodes.map((node, index) => ({ ...node, id: `outer-${index}`, status: 'confirmed', claimState: 'inference' })));
    project.activeScale = 'macrosphere'; const macro = await evaluate(project);
    expect(macro.nodes).toEqual([]);
    expect(macro.connections.some(edge => edge.relationshipIds?.length)).toBe(true);
    for (const edge of macro.connections) for (const member of edge.relationshipIds || []) expect(original.edges.map(local => local.id)).toContain(member);
    expect(project.graph.nodes.slice(0, original.nodes.length)).toEqual(original.nodes); expect(project.graph.edges).toEqual(original.edges);
  }), 220000);

  test('vague-continuation-asks-for-evidence', () => withLiveReview('vague-continuation', async evaluate => {
    const project = projectFor('A synthetic local case: a teacher talks with a parent.', ['Teacher', 'Parent']);
    beginPart2(project); project.part2Submission.text = WEAK_MACRO_MEMO; project.activeScale = 'exosphere';
    const review = await evaluate(project); expect(review.nodes).toEqual([]); expect(review.connections).toEqual([]);
  }), 120000);
});
