import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { reachability, scan, usages } from '../src/index.ts';

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
