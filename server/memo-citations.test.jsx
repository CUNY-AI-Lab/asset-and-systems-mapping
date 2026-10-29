// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { createDefaultProject, createPortableProject, parseProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { normalizeInput, OllamaCloudError } from './ollama.js';
import { prepareProviderMemo } from '../shared/provider-memo.js';
import { pageText } from '../src/pdfMemo.js';
import { CITATION_MEMO, CITATION_COMPARISON_CASES } from '../tests/fixtures/memo-citation-cases.js';

const ORIGIN = 'http://127.0.0.1:4177';
const systems = [];
afterEach(async () => { for (const system of systems.splice(0)) await system.close(); });
const narrative = 'Rosa meets the teacher at the school (Smith, 2025, p. 12).';
const reference = 'Smith, A. (2025). Community schooling. Example Press.';
const validReview = () => ({ guidance: [{ point: 'The memo describes Rosa meeting the teacher.', evidenceExcerpt: narrative }], nodes: [
  { label: 'Rosa', type: 'person', scale: 'micro', evidence: narrative },
  { label: 'Teacher', type: 'role', scale: 'micro', evidence: narrative },
], connections: [], example: null, readiness: { ready: true, note: 'Two participants are supported by the narrative.' } });
const generated = suggestion => ({ suggestion, metadata: { provider: 'cail-gateway', model: 'test-model' } });

async function setup(run, text = CITATION_MEMO) {
  const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
    ...(run ? { ollamaConfig: { apiKey: 'test-only', model: 'test-model' }, suggestionProvider: 'cail-gateway', ollamaRequest: run } : {}),
  });
  systems.push(system);
  await system.ready;
  const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '101' }) });
  const project = createDefaultProject();
  project.submission.text = text;
  const payload = preflightEvaluationPayload(project);
  const evaluate = (signal, guidanceTimeoutMs) => system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: access.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify(payload), ...(signal ? { signal } : {}),
  }, guidanceTimeoutMs === undefined ? undefined : { verifiedAccount: { studentSession: { sessionRef: '0123456789abcdef', expiresAt: Date.now() + 3600000 }, guidanceTimeoutMs } });
  return { system, project, payload, evaluate, headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: access.headers.get('set-cookie').split(';')[0] } };
}

describe('citation-aware memo guidance and recovery', () => {
  it.each(['pasted', 'pdf'])('preserves the entire %s memo, references and source identity through generation and storage', async kind => {
    const text = kind === 'pdf' ? pageText(CITATION_MEMO.split('\n').map(str => ({ str, hasEOL: true }))) : CITATION_MEMO;
    const run = vi.fn(async input => {
      const wire = JSON.parse(normalizeInput(input).projectInput);
      expect(wire.memoText).toBe(prepareProviderMemo(text).sourceText);
      expect(wire.memoText).not.toContain(reference);
      expect(wire.memoContext.structure.bibliographySectionsOmitted).toBe(1);
      expect(wire.memoContext.structure.bibliographyRanges).toHaveLength(1);
      expect(input.systemPrompt).toContain('Bibliography entries are source metadata');
      return generated(validReview());
    });
    const { system, evaluate, payload } = await setup(run, text);
    const response = await evaluate();
    expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.guidance[0].evidenceExcerpt).toBe(narrative);
    const stored = system.db.prepare('SELECT source_material, source_record_json FROM preflight_evaluations WHERE id = ?').get(evaluation.id);
    expect(stored.source_material).toBe(text);
    expect(JSON.parse(stored.source_record_json)).toEqual(payload.sourceRecord);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sends a bibliography-heavy memo within the narrative limit and saves the complete source', async () => {
    const bibliography = Array.from({ length: 1800 }, (_, index) => `Researcher, A. (2025). A long synthetic publication title ${index} about unrelated source metadata. Example Press.`).join('\n');
    const text = `${narrative}\n\nWorks Cited\n${bibliography}\n\nAppendix A: Observations\nRosa brings the referral form to the navigator.`;
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(131072);
    const run = vi.fn(async input => {
      expect(input.sourceText).toContain(narrative);
      expect(input.sourceText).toContain('Rosa brings the referral form');
      expect(input.sourceText).not.toContain('Example Press');
      expect(input.memoContext.structure.bibliographySectionsOmitted).toBeGreaterThan(0);
      return generated(validReview());
    });
    const { system, evaluate } = await setup(run, text);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(system.db.prepare('SELECT source_material FROM preflight_evaluations WHERE id = ?').get(evaluation.id).source_material).toBe(text);
  });

  it.each(['connections', 'map-check'])('omits bibliography entries from %s provider input while keeping inline citations and later narrative', async kind => {
    const text = `${narrative}\n\nWorks Cited\n${reference}\n\nAppendix A: Field Notes\nRosa brings a referral form to the teacher.`;
    const nodes = [{ id: 'rosa', label: 'Rosa', type: 'person', scale: 'micro' }, { id: 'teacher', label: 'Teacher', type: 'role', scale: 'micro' }];
    const run = vi.fn(async input => {
      const wire = JSON.parse(normalizeInput(input).projectInput);
      expect(wire.memoText).toContain(narrative);
      expect(wire.memoText).toContain('Rosa brings a referral form');
      expect(wire.memoText).not.toContain(reference);
      expect(wire.memoContext.structure.bibliographySectionsOmitted).toBe(1);
      return generated(kind === 'connections' ? { connections: [] } : { notes: [{ kind: 'gap', point: 'Check the referral exchange.', refs: ['rosa', 'teacher'] }] });
    });
    const { system, payload, headers } = await setup(run, text);
    const response = await system.app.request(ORIGIN + (kind === 'connections' ? '/api/map/connections' : '/api/map/check'), { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'meso', inquiry: '', nodes, relationships: [], projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
      ...(kind === 'connections' ? { prompt: text } : { memoExcerpt: text, intent: 'gaps', scopes: [] }),
    }) });
    expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['author', 'reference-evidence', 'invented-quote'])('uses a distinct evidence repair after repeated %s failures and records its attempts', async failure => {
    const invalid = validReview();
    if (failure === 'author') invalid.nodes[0] = { label: 'A. Smith', type: 'person', scale: 'micro', evidence: reference };
    if (failure === 'reference-evidence') invalid.guidance[0].evidenceExcerpt = reference;
    if (failure === 'invented-quote') invalid.guidance[0].evidenceExcerpt = 'Rosa interviewed Smith about access.';
    const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(validReview()));
    const { system, project, evaluate } = await setup(run);
    const response = await evaluate();
    expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(run).toHaveBeenCalledTimes(3);
    const repair = run.mock.calls[2][0];
    expect(repair.systemPrompt).toContain('FINAL EVIDENCE REPAIR');
    expect(repair.sourceText).toBe(prepareProviderMemo(CITATION_MEMO).sourceText);
    expect(repair.memoContext.evidenceRepair.passages.some(passage => passage.text.includes('Rosa meets'))).toBe(true);
    expect(repair.memoContext.evidenceRepair.passages.every(passage => !passage.text.includes(reference))).toBe(true);
    const signals = run.mock.calls.map(call => call[2].signal);
    expect(signals.every(signal => signal === signals[0])).toBe(true);
    expect(evaluation.runtime).toMatchObject({ correctiveRetries: 2, evidenceRepairAttempts: 1 });
    project.preflight = { memoReview: evaluation.review, configurationSnapshot: evaluation.configSnapshot, sourceFingerprint: 'fixture-source', evaluation: { evaluationId: evaluation.id, createdAt: evaluation.createdAt, expiresAt: evaluation.expiresAt, runtime: evaluation.runtime } };
    expect(parseProject(JSON.stringify(createPortableProject(project, 'private'))).preflight.evaluation.runtime.evidenceRepairAttempts).toBe(1);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(1);
  });

  it('rejects unsupported paraphrases in the final repair and saves no partial review', async () => {
    const invalid = validReview(); invalid.guidance[0].evidenceExcerpt = reference;
    const ungrounded = validReview(); ungrounded.nodes[0].evidence = 'Rosa works as a teacher at this school.';
    const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(ungrounded));
    const { system, evaluate } = await setup(run);
    const response = await evaluate();
    expect(response.status).toBe(502);
    expect((await response.json()).details).toMatchObject({ correctiveRetries: 2, evidenceRepairAttempts: 1 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('stops after ordinary correction for a repeated schema error', async () => {
    const invalid = { ...validReview(), extra: 'unsupported' };
    const run = vi.fn(async () => generated(invalid));
    const { evaluate } = await setup(run);
    expect((await evaluate()).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(['quota_exceeded', 'request_timeout', 'provider_unavailable'])('does not start a grounding repair after %s', async code => {
    const invalid = validReview(); invalid.guidance[0].evidenceExcerpt = reference;
    const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockRejectedValueOnce(new OllamaCloudError('Provider failed', code));
    const { evaluate, system } = await setup(run);
    expect((await evaluate()).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(2);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('continues evidence repair when rejected output also contains a malformed node', async () => {
    const invalid = validReview(); invalid.guidance[0].evidenceExcerpt = reference; invalid.nodes[0] = null;
    const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(validReview()));
    const { evaluate } = await setup(run);
    expect((await evaluate()).status).toBe(201);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([85000, 25000, 85001, -1])('bounds the verified generation budget %s and shares it across correction attempts', async configured => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const invalid = validReview(); invalid.guidance[0].evidenceExcerpt = reference;
      const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockResolvedValueOnce(generated(validReview()));
      const { evaluate } = await setup(run);
      expect((await evaluate(undefined, configured)).status).toBe(201);
      const milliseconds = configured > 0 && configured <= 85000 ? configured : 25000;
      expect(timeout).toHaveBeenCalledWith(expect.any(Function), milliseconds);
      const timerIndex = timeout.mock.calls.findIndex(call => call[1] === milliseconds);
      expect(clear).toHaveBeenCalledWith(timeout.mock.results[timerIndex].value);
      expect(run.mock.calls[0][2].signal).toBe(run.mock.calls[1][2].signal);
    } finally { timeout.mockRestore(); clear.mockRestore(); }
  });

  it('keeps the shared deadline binding even when an adapter returns after abort', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    try {
      const run = vi.fn(async () => { timeout.mock.calls.find(call => call[1] === 25000)[0](); return generated(validReview()); });
      const { evaluate, system } = await setup(run);
      expect((await evaluate()).status).toBe(502);
      expect(run).toHaveBeenCalledTimes(1);
      expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
    } finally { timeout.mockRestore(); }
  });

  it.each([undefined, 85000])('honors cancellation before starting additional evidence repair for budget %s', async budget => {
    const caller = new AbortController();
    const invalid = validReview(); invalid.guidance[0].evidenceExcerpt = reference;
    const run = vi.fn().mockResolvedValueOnce(generated(invalid)).mockImplementationOnce(async () => { caller.abort(); return generated(invalid); });
    const { evaluate } = await setup(run);
    expect((await evaluate(caller.signal, budget)).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps a cited author who separately participates in the narrative', async () => {
    const text = CITATION_COMPARISON_CASES.find(fixture => fixture.id === 'narrative-author-and-citation').text;
    const review = validReview();
    review.guidance = [];
    review.nodes = [{ label: 'Teacher Smith', type: 'person', scale: 'micro', evidence: 'Teacher Smith meets Rosa at the school.' }, { label: 'Rosa', type: 'person', scale: 'micro', evidence: 'Teacher Smith meets Rosa at the school.' }];
    const run = vi.fn(async () => generated(review));
    const { evaluate } = await setup(run, text);
    expect((await evaluate()).status).toBe(201);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps the local deterministic reader from proposing bibliography-only names', async () => {
    const { evaluate } = await setup(null);
    const response = await evaluate();
    expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.nodes.length).toBeGreaterThan(0);
    for (const node of evaluation.review.nodes) expect(CITATION_COMPARISON_CASES.find(fixture => fixture.id === 'pasted-inline-references').bibliographyOnlyLabels).not.toContain(node.label);
  });
});
