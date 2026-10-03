// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const railway = JSON.parse(readFileSync(new URL('../package.railway.json', import.meta.url), 'utf8'));
const rootLock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const railwayLock = readFileSync(new URL('../pnpm-lock.railway.yaml', import.meta.url), 'utf8');

function resolvedDirectVersions(lock) {
  const importer = lock.split('\npackages:\n')[0];
  return new Map([...importer.matchAll(/^      (.+):\n        specifier: .+\n        version: (.+)$/gm)]
    .map(([, name, version]) => [name.replace(/^'|'$/g, ''), version]));
}

describe('Railway public-only package', () => {
  it('reuses the application public dependency pins without private CAIL packages', () => {
    expect(railway.packageManager).toBe(root.packageManager);
    expect(railway.engines).toEqual(root.engines);
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(railway[group])) {
        expect(name).not.toMatch(/^@cuny-ai-lab\//);
        expect(version).toBe(root[group][name]);
      }
    }
    for (const name of Object.keys(root.dependencies).filter(name => !name.startsWith('@cuny-ai-lab/'))) {
      expect(railway.dependencies[name]).toBe(root.dependencies[name]);
    }
    expect(railway.scripts.start).toBe(root.scripts.start);
    expect(railway.scripts['db:migrate']).toBe(root.scripts['db:migrate']);
    const rootVersions = resolvedDirectVersions(rootLock);
    for (const [name, version] of resolvedDirectVersions(railwayLock)) {
      expect(version).toBe(rootVersions.get(name));
    }
  });

  it('builds the legacy frontend with no package credentials or root manifest overwrite', () => {
    const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    expect(docker.match(/COPY package\.railway\.json \.\/package\.json/g)).toHaveLength(2);
    expect(docker.match(/COPY pnpm-lock\.railway\.yaml \.\/pnpm-lock\.yaml/g)).toHaveLength(2);
    expect(docker.match(/COPY pnpm-workspace\.railway\.yaml \.\/pnpm-workspace\.yaml/g)).toHaveLength(2);
    expect(docker).toContain('RUN VITE_ACCOUNT_WORKSPACE=false pnpm build');
    expect(docker).not.toMatch(/COPY \. \./);
    expect(docker).not.toMatch(/NODE_AUTH_TOKEN|npmrc|ARG .*TOKEN/);
    expect(railwayLock).not.toMatch(/@cuny-ai-lab|npm\.pkg\.github\.com/);
    const policy = readFileSync(new URL('../pnpm-workspace.railway.yaml', import.meta.url), 'utf8');
    expect(policy).toMatch(/allowBuilds:\s+esbuild: true/);
    expect(policy).not.toMatch(/workerd|dangerouslyAllowAllBuilds/);
  });
});
