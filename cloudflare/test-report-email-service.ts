// Local harness only. Release configurations never reference this receiver.
import { WorkerEntrypoint } from 'cloudflare:workers';
let mode = 'accepted';
let calls: any[] = [];
const receipts = new Map<string, string>();
export class ReportEmail extends WorkerEntrypoint {
  async submitPublic(input: any) {
    calls.push(input);
    const previous = receipts.get(input.reportId);
    if (previous && previous !== input.description) return { ok: false, code: 'idempotency_conflict', retryable: false };
    if (!previous) receipts.set(input.reportId, input.description);
    if (mode === 'lost-ack') throw new Error('Synthetic lost email acknowledgement');
    return { ok: true, status: 'accepted', reportId: input.reportId };
  }
}
export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== '/control') return new Response(null, { status: 404 });
    if (request.method === 'POST') {
      const value = await request.json<{ mode?: string }>();
      mode = value.mode || 'accepted'; calls = [];
    }
    return Response.json({ calls, receipts: receipts.size });
  },
};
