import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { entryPath, packageEntries, reachability, scan, usages } from '../src/index.ts';

const root = resolve(import.meta.dirname, 'fixtures/reachability');
const inventory = scan(root);
const report = reachability(inventory, ['main.ts']);

it('traces calls, constructors and module initialization without rooting declarations solely by import', () => {
  expect(inventory.diagnostics).toEqual([]);
  expect(
    report.declarations
      .filter((s) => s.status === 'reachable')
      .map((s) => s.name)
      .sort(),
  ).toEqual(['Worker', 'constructor', 'initialize', 'leaf', 'start']);
  for (const name of ['left', 'right']) {
    expect(usages(inventory, name).counts.directCallSites).toBe(1);
    expect(report.declarations.find((s) => s.name === name)?.status).toBe('no-known-path');
  }
  const start = usages(inventory, 'start').symbol.id;
  const leaf = usages(inventory, 'leaf').symbol.id;
  expect(report.reached.find((n) => n.id === leaf)?.via).toMatchObject({
    from: start,
    kind: 'call',
    location: { file: 'service.ts', line: 1 },
  });
  expect(report.reached.find((n) => n.id === start)?.via).toMatchObject({
    from: 'module:main.ts',
    location: { line: 4 },
  });
});

it('loads deferred modules only from reached callers and combines multiple roots deterministically', () => {
  expect(report.reached.map((n) => n.id)).not.toContain('module:late.ts');
  const both = reachability(inventory, ['alternate.ts', 'main.ts']);
  expect(both.declarations.find((s) => s.name === 'lateInit')?.status).toBe('reachable');
  expect(both.declarations.find((s) => s.name === 'typeModuleInit')?.status).toBe('no-known-path');
  expect(reachability(inventory, ['main.ts', './alternate.ts', 'main.ts'])).toEqual(both);
  const legacy = {
    ...inventory,
    modules: inventory.modules.map((module) => {
      const copy = { ...module };
      delete copy.callerId;
      return copy;
    }),
  };
  expect(reachability(legacy, ['main.ts'])).toEqual(report);
});

it('rejects missing entries and returns the library report from the compiled CLI', () => {
  expect(() => reachability(inventory, [])).toThrow('at least one');
  expect(() => reachability(inventory, ['missing.ts'])).toThrow('not analyzed');
  const cli = resolve(import.meta.dirname, '../dist/cli.js');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, root, ...args], { encoding: 'utf8', timeout: 10000 });
  expect(JSON.parse(run('--entry', 'main.ts', '--format', 'json').stdout)).toEqual(report);
  expect(run('--entry', 'main.ts', '--format', 'markdown').stdout).toContain('## Paths');
  expect(run('--entry', 'missing.ts').status).toBe(1);
});

it('uses package exports and bins as roots and reconstructs a shortest declaration path', () => {
  const roots = packageEntries(root, inventory);
  expect(roots).toEqual(['alternate.ts', 'main.ts']);
  const cli = resolve(import.meta.dirname, '../dist/cli.js');
  const result = spawnSync(process.execPath, [cli, root, '--package-entries', '--format', 'json'], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(reachability(inventory, roots));
  const leaf = usages(inventory, 'leaf').symbol.id;
  expect(entryPath(report, leaf)?.map((n) => n.id)).toEqual([
    'module:main.ts',
    usages(inventory, 'start').symbol.id,
    leaf,
  ]);
  expect(entryPath(report, usages(inventory, 'left').symbol.id)).toBeNull();
});

it('expands package patterns against source and compiler outputs, honoring private and remapped subpaths', () => {
  const dir = resolve(import.meta.dirname, 'fixtures/export-patterns');
  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, '../dist/cli.js'),
      dir,
      '--project',
      'tsconfig.json',
      '--project',
      'jsconfig.json',
      '--package-entries',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).entries).toEqual([
    'src/group/public.ts',
    'src/nested/open.ts',
    'src/visible.ts',
    'variants/red/red.cjs',
  ]);
});

it('combines entry globs with explicit and package roots and rejects a glob matching only excluded files', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [resolve(import.meta.dirname, '../dist/cli.js'), root, ...args], { encoding: 'utf8' });
  const selected = run(
    '--entry-glob',
    './{init,main}.ts',
    '--entry',
    'init.ts',
    '--entry-glob',
    'alt*.ts',
    '--package-entries',
    '--format',
    'json',
  );
  expect(selected.status).toBe(0);
  expect(JSON.parse(selected.stdout)).toEqual(reachability(inventory, ['alternate.ts', 'main.ts', 'init.ts']));
  const excluded = run('--entry', 'main.ts', '--entry-glob', 'late*.ts', '--exclude', 'late.ts');
  expect(excluded.status).toBe(1);
  expect(excluded.stderr).toContain('No analyzed entry files match: late*.ts');
  expect(run('--entry-glob', '*.ts', '--symbol', 'leaf').status).toBe(1);
});
