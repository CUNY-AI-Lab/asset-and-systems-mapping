const TOOLS_ORIGIN = 'https://tools.ailab.gc.cuny.edu';
const TOOLS_MOUNT = '/systems-mapping';
const clientPage = (path: string) => path === '/' || /^\/p\/[A-Za-z0-9_-]{20,64}\/?$/.test(path);

/** Only public frontend documents and files can bypass account verification. */
export function toolsPublicPath(path: string): 'page' | 'asset' | null {
  if (clientPage(path) || path === '/index.html') return 'page';
  if (['/theme.js', '/favicon.svg', '/favicon.png'].includes(path)
    || /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2|png|svg)$/.test(path)) return 'asset';
  return null;
}

/** Called only after the dedicated login route verifies both signed grants. */
export function toolsLoginRedirect(request: Request): Response {
  const values = new URL(request.url).searchParams.getAll('returnTo');
  const target = values.length ? values[0] : `${TOOLS_MOUNT}/`;
  const invalid = () => new Response('The return page was not accepted.', { status: 400 });
  if (values.length > 1 || target.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(target)
    || !target.startsWith('/') || target.startsWith('//')) return invalid();
  const url = new URL(target, TOOLS_ORIGIN);
  const path = url.pathname.slice(TOOLS_MOUNT.length) || '/';
  if (url.origin !== TOOLS_ORIGIN || !(url.pathname === TOOLS_MOUNT || url.pathname.startsWith(`${TOOLS_MOUNT}/`))
    || !clientPage(path)) return invalid();
  return new Response(null, { status: 303, headers: { location: `${TOOLS_MOUNT}${path}${url.search}${url.hash}` } });
}

/** Validate the browser boundary before translating to the app's root paths. */
export function toolsRequest(request: Request, appOrigin: string): Request | Response {
  const url = new URL(request.url);
  if (url.origin !== TOOLS_ORIGIN
    || (url.pathname !== TOOLS_MOUNT && !url.pathname.startsWith(`${TOOLS_MOUNT}/`))) {
    return new Response('Not found.', { status: 404 });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    && (request.headers.get('origin') !== TOOLS_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return new Response('Request origin was not accepted.', { status: 403 });
  }
  const path = url.pathname.slice(TOOLS_MOUNT.length) || '/';
  const api = path === '/api' || path.startsWith('/api/');
  if (path.startsWith('//') || path.includes('%') || path.includes('\\')
    || !api && path !== '/auth/login' && !toolsPublicPath(path)) {
    return new Response('Not found.', { status: 404 });
  }
  if (!api && !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const target = new URL(path, appOrigin);
  target.search = url.search;
  const headers = new Headers(request.headers);
  const forwardedIp = headers.get('x-forwarded-for');
  for (const name of [...headers.keys()]) {
    if (name === 'authorization' || name === 'cookie' || name === 'cf-access-jwt-assertion'
      || name.startsWith('x-cail-') || name.startsWith('x-forwarded-')) headers.delete(name);
  }
  headers.set('host', target.host);
  // Doorway sets this from Cloudflare's client address after stripping caller
  // forwarding headers. Only this private entrypoint translates the field.
  headers.delete('cf-connecting-ip');
  if (forwardedIp && /^[0-9a-fA-F:.]{3,45}$/.test(forwardedIp)) headers.set('cf-connecting-ip', forwardedIp);
  if (headers.has('origin')) headers.set('origin', target.origin);
  // Reporting also verifies Referer. Translate only a same-origin referrer;
  // foreign values remain foreign and are rejected by the existing handler.
  const referer = headers.get('referer');
  if (referer) {
    try {
      const source = new URL(referer);
      if (source.origin === TOOLS_ORIGIN) headers.set('referer', `${target.origin}/`);
    } catch { /* The reporting boundary rejects malformed referrers. */ }
  }
  return new Request(target, { method: request.method, headers, body: request.body, redirect: 'manual', signal: request.signal });
}

/** Normalize HTML asset URLs; imports and fonts remain relative to their files. */
export function appDocument(response: Response, mounted = false, appOrigin?: string): Response {
  if (mounted) {
    const headers = new Headers(response.headers);
    headers.delete('set-cookie');
    const location = headers.get('location');
    if (location && appOrigin) {
      const destination = new URL(location, appOrigin);
      if (destination.origin === appOrigin) headers.set('location', `${TOOLS_MOUNT}${destination.pathname}${destination.search}${destination.hash}`);
    }
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/html') || !response.body) return response;
  return new HTMLRewriter()
    .on('[src], link[href]', { element(element) {
      const attribute = element.hasAttribute('src') ? 'src' : 'href';
      const path = element.getAttribute(attribute);
      const assetPath = path?.startsWith('./') ? path.slice(1)
        : path?.startsWith('/') && !path.startsWith('//') ? path : null;
      if (assetPath) element.setAttribute(attribute, `${mounted ? TOOLS_MOUNT : ''}${assetPath}`);
    } })
    .transform(response);
}
