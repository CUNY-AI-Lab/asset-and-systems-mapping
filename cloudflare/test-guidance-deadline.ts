// Local runtime harness only. Never referenced by a release configuration.
import { DurableObject } from 'cloudflare:workers';
import { createMappingHandler } from './worker';

export class StalledCourse extends DurableObject {
  private started = 0;
  private completed = 0;

  async request(request: Request, _principal: unknown, _correlation: unknown): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ started: this.started, completed: this.completed });
    this.started++;
    // Deliberately ignore the request's cancellation signal, as a queued RPC
    // might. The caller must return without claiming this work was cancelled.
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.completed++;
    return Response.json({ result: 'late' });
  }
}

export default createMappingHandler({ testOnlyGuidanceTimeoutMs: 250 });
