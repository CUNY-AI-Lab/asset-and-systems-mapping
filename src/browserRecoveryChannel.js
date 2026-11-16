const PREFIX = 'systems-mapping-browser-recovery-v1';
const validToken = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

// Only the port carries the account proof and private snapshot. A WindowProxy
// can outlive navigation; a transferred MessagePort belongs to this document.
export function receiveRecovery({ host = window, popup, peerOrigin, nonce, proof, onSnapshot, onError, Channel = MessageChannel }) {
  let channel, settled = false;
  const stop = () => { clearTimeout(timer); host.removeEventListener('message', ready); channel?.port1.close(); };
  const fail = () => { if (settled) return; settled = true; stop(); onError(new Error('Recovery timed out or was interrupted. Keep both workspaces and try again.')); };
  const timer = setTimeout(fail, Math.max(1, Math.min(120_000, proof.expiresAt - Date.now())));
  const ready = event => {
    if (event.origin !== peerOrigin || event.source !== popup || event.data?.type !== `${PREFIX}:ready` || channel) return;
    channel = new Channel();
    host.removeEventListener('message', ready);
    channel.port1.onmessage = async ({ data }) => {
      if (settled || data?.nonce !== nonce) return;
      if (data.type === 'error') return fail();
      if (data.type !== 'snapshot' || !validToken(data.receipt) || !validToken(data.fingerprint) || typeof data.raw !== 'string') return fail();
      settled = true; stop();
      try { await onSnapshot(data); } catch (error) { onError(error); }
    };
    popup.postMessage({ type: `${PREFIX}:connect`, nonce }, peerOrigin, [channel.port2]);
    channel.port1.postMessage({ type: 'authorize', nonce, token: proof.token });
  };
  host.addEventListener('message', ready);
  return () => { settled = true; stop(); };
}

export function offerRecovery({ host = window, opener = window.opener, peerOrigin, onAuthorization }) {
  let port, timer;
  const connect = event => {
    if (!opener || event.source !== opener || event.origin !== peerOrigin || event.data?.type !== `${PREFIX}:connect`
      || !validToken(event.data.nonce) || event.ports?.length !== 1 || port) return;
    const nonce = event.data.nonce;
    port = event.ports[0];
    host.removeEventListener('message', connect);
    port.onmessage = ({ data }) => {
      if (data?.type !== 'authorize' || data.nonce !== nonce || !validToken(data.token)) return;
      port.onmessage = null;
      onAuthorization({ nonce, token: data.token, send: data => port.postMessage({ ...data, nonce }) });
    };
    port.start();
    timer = setTimeout(() => port.close(), 120_000);
  };
  host.addEventListener('message', connect);
  opener?.postMessage({ type: `${PREFIX}:ready` }, peerOrigin);
  return () => { clearTimeout(timer); host.removeEventListener('message', connect); port?.close(); };
}
