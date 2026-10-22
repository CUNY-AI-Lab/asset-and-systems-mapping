/** Shared CAIL report footer: one field, existing SSO, memory-only drafts. */
export function mountBugReport(container, { loginUrl = '/auth/start', path = () => location.pathname,
  sessionEndpoint = '/api/bug-reports/session', endpoint = '/api/bug-reports' } = {}) {
  // Constant markup only. Report and service data are rendered as text/value.
  container.innerHTML = `<div class="bug-report">
    <button class="bug-report__trigger" type="button" aria-label="Report a bug" aria-haspopup="dialog" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 2 2 2m4 0 2-2M9 7V6a3 3 0 0 1 6 0v1M6 10H2m4 4H2m4 4H2m16-8h4m-4 4h4m-4 4h4"/><rect x="6" y="7" width="12" height="14" rx="6"/><path d="M12 11v10"/></svg>
      <span class="bug-report__trigger-label" aria-hidden="true"><span>Report a bug</span><span class="bug-report__badge" hidden>Draft</span></span>
    </button>
    <section class="bug-report__panel" popover="manual" role="dialog" aria-modal="false" aria-label="Report a bug" tabindex="-1" hidden>
      <header class="bug-report__heading">
        <h2>Report a bug</h2>
        <button class="bug-report__close" type="button" aria-label="Close bug report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </header>
      <form class="bug-report__form" aria-label="Report a bug">
        <div class="bug-report__field">
          <div class="bug-report__label"><label><span class="bug-report__sr-only">What went wrong?</span><textarea name="description" required minlength="10" maxlength="4000" rows="4" readonly placeholder="What went wrong?" aria-describedby="bug-report-privacy"></textarea></label><span class="bug-report__count" aria-hidden="true">0 / 4,000</span></div>
        </div>
        <details class="bug-report__details"><summary>Details</summary><p id="bug-report-privacy" class="bug-report__help">Private report. Includes account, page, version and time. No files attached. Draft clears on reload.</p></details>
        <p class="bug-report__status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="bug-report__session" hidden><a target="_blank" rel="noopener noreferrer" aria-label="CUNY Login (opens a new tab)">CUNY Login ↗</a><button type="button">Check sign-in</button></div>
        <div class="bug-report__actions"><button type="submit" disabled>Send</button></div>
      </form>
    </section>
  </div>`;
  const panel = container.querySelector('.bug-report__panel'), form = container.querySelector('form');
  const trigger = container.querySelector('.bug-report__trigger'), closeButton = container.querySelector('.bug-report__close');
  const badge = trigger.querySelector('.bug-report__badge'), count = form.querySelector('.bug-report__count');
  const instanceId = `bug-report-${crypto.randomUUID()}`;
  panel.id = instanceId; trigger.setAttribute('aria-controls', instanceId);
  form.querySelector('.bug-report__help').id = `${instanceId}-privacy`;
  const description = form.elements.namedItem('description'), status = form.querySelector('[role="status"]');
  description.setAttribute('aria-describedby', `${instanceId}-privacy`);
  const submitButton = form.querySelector('[type="submit"]'), sessionControls = form.querySelector('.bug-report__session');
  const signIn = sessionControls.querySelector('a'), checkButton = sessionControls.querySelector('button');
  signIn.href = loginUrl;
  let actor = null, report = null, snapshot = '', busy = false, checking = false, ready = false;
  let locked = false, done = false, terminal = false, disposed = false, cooldown = null, controller = null;
  let isOpen = false, layoutFrame = null;
  const nativePopover = typeof panel.showPopover === 'function';
  const show = (message, tone = 'info') => { status.textContent = message; panel.dataset.tone = tone; schedulePosition(); };
  const hasDraft = () => !done && (description.value.length > 0 || report !== null);
  const draftChanged = () => {
    const pending = hasDraft();
    badge.hidden = !pending && !done; badge.textContent = done ? 'Sent' : 'Draft';
    count.textContent = `${description.value.length.toLocaleString('en-US')} / 4,000`;
    if (container.dataset.reportDraft !== String(pending)) {
      container.dataset.reportDraft = String(pending);
      container.dispatchEvent(new CustomEvent('cail:report-draft', { bubbles: true, detail: { pending } }));
    }
  };
  const render = () => {
    description.readOnly = busy || checking || !ready || locked || done || terminal;
    submitButton.disabled = busy || checking || !ready || done || terminal || Boolean(cooldown);
    checkButton.disabled = busy || checking;
    sessionControls.hidden = ready || done || terminal;
    form.toggleAttribute('aria-busy', busy || checking);
    if (busy || checking) form.setAttribute('aria-busy', 'true');
    panel.dataset.state = done ? 'saved' : busy ? 'sending' : checking ? 'checking' : 'idle';
    draftChanged();
    schedulePosition();
  };
  const needsSignIn = (changed = false) => {
    ready = false;
    show(changed
      ? 'Account changed. Use your original account.'
      : 'Sign in to report.', 'attention');
    render();
  };
  const uncertain = () => {
    locked = true; submitButton.textContent = 'Check status';
    show(`Not confirmed. Check again. Ref: ${report.reportId}.`, 'attention');
  };
  const wait = seconds => {
    clearTimeout(cooldown);
    cooldown = setTimeout(() => { cooldown = null; if (!disposed) render(); }, seconds * 1000);
  };
  const codeOf = result => result?.code ?? result?.details?.code ?? result?.error?.code;
  async function fetchJson(url, options = {}) {
    controller = new AbortController();
    const deadline = setTimeout(() => controller?.abort(), 30000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      return { response, result: await response.json() };
    } finally { clearTimeout(deadline); controller = null; }
  }
  async function checkSession() {
    if (busy || checking || done || disposed) return;
    checking = true; show('Checking…'); render();
    try {
      const { response, result } = await fetchJson(sessionEndpoint);
      if (disposed) return;
      if (response.ok && result?.ok === true && /^[0-9a-f]{64}$/.test(result.expectedActor)) {
        if (actor && actor !== result.expectedActor) { needsSignIn(true); return; }
        actor = result.expectedActor; ready = true;
        show(locked ? 'Check your report’s status.'
          : '');
      } else if (response.status === 401 || response.status === 403) needsSignIn();
      else { ready = false; show('Sign-in unavailable. Try again.', 'attention'); }
    } catch { if (!disposed) { ready = false; show('Sign-in unavailable. Try again.', 'attention'); } }
    finally { checking = false; if (!disposed) render(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || checking || done || terminal || cooldown || !ready || !actor) return;
    if (!locked && !form.reportValidity()) return;
    if (!locked) {
      const data = { description: description.value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim(), path: path() };
      const next = JSON.stringify(data);
      if (snapshot !== next) { snapshot = next; report = { reportId: crypto.randomUUID(), ...data, expectedActor: actor }; }
    }
    busy = true; show(locked ? 'Checking…' : 'Sending…'); render();
    try {
      const { response, result } = await fetchJson(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      if (disposed) return;
      const code = codeOf(result);
      if (response.ok && result?.ok === true && result.status === 'saved' && result.reportId === report.reportId
        && typeof result.createdAt === 'string' && Number.isFinite(Date.parse(result.createdAt))) {
        done = true; locked = true; submitButton.textContent = 'Sent';
        show(`Sent. Thank you.`, 'success');
      } else if (response.status === 401 || code === 'not_admitted' || code === 'admission_required') needsSignIn();
      else if (code === 'account_changed') needsSignIn(true);
      else if (code === 'idempotency_conflict') {
        terminal = true; show('Report changed. Copy your text and start again.', 'attention');
      } else if (code === 'invalid' && !locked) {
        submitButton.textContent = 'Try again'; show('Use 10–4,000 characters.', 'attention');
      } else if (response.status === 429 || code === 'rate_limited') {
        const delay = result?.retryAfterSeconds ?? result?.details?.retryAfterSeconds ?? Number(response.headers.get('retry-after'));
        const seconds = Number.isSafeInteger(delay) && delay > 0 && delay <= 86400 ? delay : 60;
        submitButton.textContent = locked ? 'Check status' : 'Try again';
        show(`Try again in ${Math.ceil(seconds / 60)} min.`, 'attention'); wait(seconds);
      } else if (code === 'forbidden' || response.status === 403) {
        terminal = true; show('Couldn’t send. Copy your text before reloading.', 'attention');
      } else if (code === 'redmine_rejected') {
        terminal = true; show('Couldn’t send. Contact the Lab.', 'attention');
      } else {
        uncertain();
        const seconds = result?.retryAfterSeconds;
        if (Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400) wait(seconds);
      }
    } catch { if (!disposed) uncertain(); }
    finally {
      busy = false;
      if (!disposed) {
        render();
        requestAnimationFrame(() => { if (!disposed && isOpen) status.scrollIntoView({ block: 'nearest' }); });
      }
    }
  }
  function positionPanel() {
    if (!isOpen || disposed) return;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 12, topEdge = (viewport?.offsetTop ?? 0) + 12;
    const rightEdge = leftEdge + width - 24, bottomEdge = topEdge + height - 24;
    const anchor = trigger.getBoundingClientRect();
    const panelWidth = Math.min(408, width - 24);
    // Apps can reserve space above a fixed navigation or playback footer.
    const clearance = parseFloat(getComputedStyle(panel).scrollMarginBottom) || 0;
    const above = anchor.top - topEdge - 10 - clearance, below = bottomEdge - anchor.bottom - 10;
    const opensAbove = above >= Math.min(340, height - 24) || above >= below;
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${Math.max(120, Math.min(height - 24, opensAbove ? above : below))}px`;
    const panelHeight = panel.getBoundingClientRect().height;
    panel.style.left = `${Math.max(leftEdge, Math.min(anchor.right - panelWidth, rightEdge - panelWidth))}px`;
    panel.style.top = `${Math.max(topEdge, Math.min(opensAbove ? anchor.top - 10 - clearance - panelHeight : anchor.bottom + 10, bottomEdge - panelHeight))}px`;
    panel.dataset.placement = opensAbove ? 'above' : 'below';
  }
  function schedulePosition() {
    if (!isOpen || disposed || layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = null; positionPanel(); });
  }
  function closePanel(returnFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    if (nativePopover) panel.hidePopover();
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && !disposed) trigger.focus({ preventScroll: true });
  }
  function togglePanel() {
    if (isOpen) { closePanel(); return; }
    isOpen = true; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    if (nativePopover) panel.showPopover();
    render(); positionPanel(); closeButton.focus({ preventScroll: true });
    if (!done && !terminal) void checkSession();
  }
  const closeClick = () => closePanel();
  const outside = event => { if (isOpen && !panel.contains(event.target) && !trigger.contains(event.target)) closePanel(false); };
  const escape = event => {
    if (isOpen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); }
  };
  const beforeUnload = event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } };
  const panelResize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePosition) : null;
  panelResize?.observe(panel);
  form.addEventListener('submit', submit); checkButton.addEventListener('click', checkSession);
  description.addEventListener('input', draftChanged); trigger.addEventListener('click', togglePanel); closeButton.addEventListener('click', closeClick);
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
  window.addEventListener('resize', schedulePosition); window.addEventListener('scroll', schedulePosition, true);
  window.visualViewport?.addEventListener('resize', schedulePosition); window.visualViewport?.addEventListener('scroll', schedulePosition);
  window.addEventListener('beforeunload', beforeUnload); render();
  const dispose = () => {
    disposed = true; closePanel(false); panelResize?.disconnect(); controller?.abort(); clearTimeout(cooldown); cancelAnimationFrame(layoutFrame);
    form.removeEventListener('submit', submit); checkButton.removeEventListener('click', checkSession);
    description.removeEventListener('input', draftChanged); trigger.removeEventListener('click', togglePanel); closeButton.removeEventListener('click', closeClick);
    document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true);
    window.removeEventListener('resize', schedulePosition); window.removeEventListener('scroll', schedulePosition, true);
    window.visualViewport?.removeEventListener('resize', schedulePosition); window.visualViewport?.removeEventListener('scroll', schedulePosition);
    window.removeEventListener('beforeunload', beforeUnload); delete container.dataset.reportDraft; container.replaceChildren();
  };
  dispose.hasDraft = hasDraft;
  dispose.sessionChanged = () => { if (!disposed && !done) needsSignIn(); };
  return dispose;
}
