export const TOOLS_ORIGIN = 'https://tools.ailab.gc.cuny.edu';
export const TOOLS_MOUNT = '/systems-mapping';

// The same frontend runs at the original Worker root and at its CUNY mount.
// Only the exact Tools origin and path opt into the mounted application.
export function appMount(location = globalThis.window?.location) {
  return location?.origin === TOOLS_ORIGIN
    && (location.pathname === TOOLS_MOUNT || location.pathname.startsWith(`${TOOLS_MOUNT}/`))
    ? TOOLS_MOUNT : '';
}

export function appPath(path, location = globalThis.window?.location) {
  return `${appMount(location)}${path}`;
}

export function appPathname(location = globalThis.window?.location) {
  return location.pathname.slice(appMount(location).length) || '/';
}
