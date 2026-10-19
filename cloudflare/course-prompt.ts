import { createHash } from 'node:crypto';
import type { CourseAccess } from './course-access';
export type CoursePrompt = { amendment: string; revision: number; updatedAt: string | null; changeNote: string;
  updatedBy?: string; updatedByName?: string | null; courseId?: string; appendixVersion?: string; amendmentHash?: string };
export const EMPTY_COURSE_PROMPT: CoursePrompt = { amendment: '', revision: 0, updatedAt: null, changeNote: '' };
export const promptFailure = (status: number, code: string, error: string) => Response.json({ error, details: { code } }, { status });
const CURRENT = 'instructor-course-prompt';
const HISTORY = 'instructor-course-prompt-history:';

export async function currentCoursePrompt(storage: DurableObjectStorage): Promise<CoursePrompt> {
  return await storage.get<CoursePrompt>(CURRENT) ?? { ...EMPTY_COURSE_PROMPT };
}

export async function coursePromptRequest(request: Request, storage: DurableObjectStorage, capabilities: CourseAccess['capabilities'], actor: { memberId: string; classId: string; displayName?: string | null }): Promise<Response> {
  if (!(request.method === 'GET' ? capabilities.promptRead : capabilities.promptWrite)) return promptFailure(403, 'course_owner_required', 'Only this course’s instructor can edit its guidance. Contact your instructor for help.');
  const path = new URL(request.url).pathname;
  if (path.endsWith('/history')) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const entries = await storage.list<CoursePrompt>({ prefix: HISTORY, reverse: true, limit: 100 });
    return Response.json({ history: [...entries.values()] });
  }
  if (request.method === 'GET') return Response.json({ prompt: await currentCoursePrompt(storage) });
  if (request.method !== 'PUT') return new Response(null, { status: 405 });
  let input;
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('content_type');
    // The outer Worker already bounds mutations; cap this small settings write too.
    const { boundedText } = await import('./bounded.js');
    input = JSON.parse(await boundedText(request, request.signal, 16384));
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== 'amendment,changeNote,expectedRevision'
      || typeof input.amendment !== 'string' || input.amendment.length > 2000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.amendment)
      || typeof input.changeNote !== 'string' || !input.changeNote.trim() || input.changeNote.trim().length > 240
      || /[\u0000-\u001f\u007f]/u.test(input.changeNote)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('invalid');
  } catch {
    return promptFailure(400, 'course_prompt_invalid', 'Guidance could not be saved. Use up to 2,000 characters and add a short change note.');
  }
  const { amendment, expectedRevision, changeNote } = input;
  return storage.transaction(async transaction => {
    const current = await transaction.get<CoursePrompt>(CURRENT) ?? { ...EMPTY_COURSE_PROMPT };
    if (current.revision !== expectedRevision) return promptFailure(409, 'course_prompt_conflict', 'Another instructor session changed this guidance. Reload the saved version before saving your draft.');
    if (current.amendment === amendment) return Response.json({ prompt: current });
    const prompt = { amendment, revision: current.revision + 1, updatedAt: new Date().toISOString(), changeNote: changeNote.trim(),
      updatedBy: actor.memberId, updatedByName: actor.displayName ?? null, courseId: actor.classId, appendixVersion: 'systems-mapping-appendix-v1',
      amendmentHash: createHash('sha256').update(amendment).digest('hex') };
    await transaction.put(CURRENT, prompt);
    await transaction.put(HISTORY + String(prompt.revision).padStart(16, '0'), prompt);
    return Response.json({ prompt });
  });
}
