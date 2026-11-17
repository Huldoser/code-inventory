import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scan, usages } from '../src/index.ts';

const root = resolve(import.meta.dirname, 'fixtures/projects');
const options = {
  projects: ['solution.json', 'other.json'],
  exclude: ['**/ignored.ts'],
  scopes: { test: ['app/**'], tooling: ['demo.ts'] },
};

it('counts shared files once and resolves cross-project calls using the owning project', () => {
  const inventory = scan(root, options);
  expect(inventory.diagnostics).toEqual([]);
  const usage = usages(inventory, 'format');
  expect(usage.counts.directCallSites).toBe(2);
  expect(
    usages(inventory, 'extra')
      .references.filter((ref) => ref.kind === 'call')
      .map((ref) => ref.location.file),
  ).toEqual(['demo.ts']);
  expect(
    usage.references
      .filter((ref) => ref.kind === 'call')
      .map((ref) => [ref.location.file, ref.location.line, ref.scope]),
  ).toEqual([
    ['app/client.ts', 3, 'test'],
    ['demo.ts', 2, 'tooling'],
  ]);
  expect(inventory.files.find((file) => file.path === 'app/client.ts')?.project).toBe('app/custom.json');
  expect(inventory.files.find((file) => file.path === 'app/ignored.ts')?.reason).toBe('scan-exclude');
  expect(scan(root, { ...options, projects: [...options.projects].reverse() })).toEqual(inventory);
});

it('traverses solution references and fingerprints inherited configuration', () => {
  const inventory = scan(root, { projects: ['solution.json'] });
  expect(inventory.config.projects).toEqual(['app/custom.json', 'lib/tsconfig.json', 'solution.json']);
  expect(inventory.config.inputs).toContainEqual({
    path: 'base.json',
    hash: createHash('sha256')
      .update(readFileSync(resolve(root, 'base.json')))
      .digest('hex'),
  });
  expect(inventory.files.find((file) => file.path === 'demo.ts')?.reason).toBe('project-config');
  expect(usages(inventory, 'format').counts.directCallSites).toBe(2);
});

it('exposes repeated projects, exclusions and scope globs through the CLI', () => {
  const cli = resolve(import.meta.dirname, '../dist/cli.js');
  const result = spawnSync(
    process.execPath,
    [
      cli,
      root,
      '--project',
      'solution.json',
      '--project',
      'other.json',
      '--exclude',
      '**/ignored.ts',
      '--test',
      'app/**',
      '--tooling',
      'demo.ts',
      '--format',
      'json',
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(scan(root, options));
  expect(() => scan(root, { projects: ['missing.json'] })).toThrow('missing.json');
});
