import { afterEach, expect, test, vi } from 'vitest';
import { receiveRecovery, offerRecovery } from './browserRecoveryChannel.js';

const nonce = 'a'.repeat(64), token = 'b'.repeat(64), peerOrigin = 'https://systems-mapping.ailab-452.workers.dev';
const host = () => {
  const listeners = new Set();
  return { addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn),
    dispatch: event => [...listeners].forEach(fn => fn(event)) };
};
const port = () => ({ postMessage: vi.fn(), close: vi.fn(), start: vi.fn(), onmessage: null });
afterEach(() => vi.useRealTimers());
test('destination accepts only its exact popup and origin and sends secrets through the transferred port', async () => {
  const window = host(), popup = { postMessage: vi.fn() }, channel = { port1: port(), port2: port() };
  const onSnapshot = vi.fn(), onError = vi.fn();
  const cleanup = receiveRecovery({ host: window, popup, peerOrigin, nonce, proof: { token, expiresAt: Date.now() + 120000 }, onSnapshot, onError, Channel: class { constructor() { return channel; } } });
  const ready = { origin: peerOrigin, source: popup, data: { type: 'systems-mapping-browser-recovery-v1:ready' } };
  window.dispatch({ ...ready, origin: 'https://foreign.example' });
  window.dispatch({ ...ready, source: {} });
  expect(popup.postMessage).not.toHaveBeenCalled();
  window.dispatch(ready);
  expect(popup.postMessage).toHaveBeenCalledWith({ type: 'systems-mapping-browser-recovery-v1:connect', nonce }, peerOrigin, [channel.port2]);
  expect(channel.port1.postMessage).toHaveBeenCalledWith({ type: 'authorize', nonce, token });
  // A navigated WindowProxy sends only another window message; private replies
  // must arrive on the port originally transferred to the verified document.
  const data = { type: 'snapshot', nonce, receipt: 'c'.repeat(64), fingerprint: 'd'.repeat(64), raw: 'fixture' };
  window.dispatch({ ...ready, data }); expect(onSnapshot).not.toHaveBeenCalled();
  await channel.port1.onmessage({ data: { ...data, nonce: 'e'.repeat(64) } }); expect(onSnapshot).not.toHaveBeenCalled();
  await channel.port1.onmessage({ data }); expect(onSnapshot).toHaveBeenCalledOnce();
  expect(channel.port1.close).toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); cleanup();
});
test('source requires its exact opener, origin and one transferred port before exposing authorization', () => {
  const window = host(), opener = { postMessage: vi.fn() }, incoming = port(), onAuthorization = vi.fn();
  const cleanup = offerRecovery({ host: window, opener, peerOrigin, onAuthorization });
  const event = { origin: peerOrigin, source: opener, data: { type: 'systems-mapping-browser-recovery-v1:connect', nonce }, ports: [incoming] };
  window.dispatch({ ...event, source: {} }); window.dispatch({ ...event, origin: 'https://foreign.example' });
  window.dispatch({ ...event, ports: [] }); expect(incoming.start).not.toHaveBeenCalled();
  window.dispatch(event); expect(incoming.start).toHaveBeenCalledOnce();
  incoming.onmessage({ data: { type: 'authorize', nonce: 'c'.repeat(64), token } }); expect(onAuthorization).not.toHaveBeenCalled();
  incoming.onmessage({ data: { type: 'authorize', nonce, token } }); expect(onAuthorization).toHaveBeenCalledOnce();
  onAuthorization.mock.calls[0][0].send({ type: 'snapshot', raw: 'private-fixture' });
  expect(incoming.postMessage).toHaveBeenCalledWith({ type: 'snapshot', raw: 'private-fixture', nonce });
  expect(JSON.stringify(opener.postMessage.mock.calls)).not.toContain('private-fixture'); cleanup();
});
test('abandoned flows close their port and time out without accepting later window messages', () => {
  vi.useFakeTimers();
  const window = host(), popup = { postMessage: vi.fn() }, onError = vi.fn();
  receiveRecovery({ host: window, popup, peerOrigin, nonce, proof: { token, expiresAt: Date.now() + 10 }, onSnapshot: vi.fn(), onError });
  vi.advanceTimersByTime(11); expect(onError).toHaveBeenCalledOnce();
  window.dispatch({ origin: peerOrigin, source: popup, data: { type: 'systems-mapping-browser-recovery-v1:ready' } });
  expect(popup.postMessage).not.toHaveBeenCalled();
});
