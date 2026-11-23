import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, onTestFinished } from 'vitest';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'inventory-impact-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'package');
  cpSync(resolve(import.meta.dirname, 'fixtures/basic'), directory, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  const cli = resolve(import.meta.dirname, '../dist/cli.js');
  const run = (base: string, ...args: string[]) =>
    spawnSync(process.execPath, [cli, directory, '--changed-since', base, ...args], {
      encoding: 'utf8',
      timeout: 10_000,
    });
  return { directory, git, run };
}

it('groups changed function uses across aliases, callbacks, exports and test files', () => {
  const { directory, git, run } = repository();
  const removed = join(directory, 'removed file.ts');
  writeFileSync(removed, 'export function gone() {}\n');
  git('add', '--', 'package');
  const base = git('write-tree');
  const definitions = join(directory, 'definitions.ts');
  writeFileSync(definitions, readFileSync(definitions, 'utf8').replace('value.trim()', 'value.trimEnd()'));
  rmSync(removed);
  const result = run(base);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('function normalize');
  expect(result.stdout).toMatch(/main.*call app\.ts:6:3.*call app\.ts:8:3/);
  expect(result.stdout).toContain('read app.ts:9:19');
  expect(result.stdout).toContain('barrel.ts#clean');
  expect(result.stdout).toContain('call spec.test.ts:4:3');
  expect(result.stdout).toContain('Deleted file: removed file.ts');
  expect(result.stdout).not.toContain('app.ts:18');
});

it('attributes a deletion inside a method and reports a removed sibling only by its old lines', () => {
  const { directory, git, run } = repository();
  const file = join(directory, 'class with spaces.ts');
  writeFileSync(file, 'class Example {\n  run() {\n    return 1;\n  }\n}\nfunction removed() {}\n');
  git('add', '--', 'package');
  const base = git('write-tree');
  writeFileSync(file, 'class Example {\n  run() {\n  }\n}\n');
  const result = run(base);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('method run (class with spaces.ts:2)');
  expect(result.stdout).not.toContain('class Example');
  expect(result.stdout).toContain('Removed base lines: class with spaces.ts:6');
});

it('maps a staged addition, flags top-level lines and ignores untracked files', () => {
  const { directory, git, run } = repository();
  git('add', '--', 'package');
  const base = git('write-tree');
  writeFileSync(join(directory, 'untracked.ts'), 'export function invisible() {}\n');
  expect(run(base).stdout).toContain('No tracked source changes.');
  writeFileSync(join(directory, '[new].ts'), 'const value = 1;\nexport function added() { return value; }\n');
  git('add', '--', 'package/[new].ts');
  const result = run(base);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('function added ([new].ts:2)');
  expect(result.stdout).toContain('Outside a declaration: [new].ts:1');
  expect(result.stdout).not.toContain('invisible');
  expect(run(base, '--symbol', 'normalize').status).toBe(1);
  expect(run('missing-revision').status).toBe(1);
});

it('keeps the enclosing function when a changed line also contains a callback', () => {
  const { directory, git, run } = repository();
  const file = join(directory, 'nested.ts');
  writeFileSync(file, 'export function outer() { return [1].map(x => x); }\nouter();\n');
  git('add', '--', 'package');
  const base = git('write-tree');
  writeFileSync(file, 'export function outer() { return [2].map(x => x); }\nouter();\n');
  const result = run(base);
  expect(result.stdout).toContain('function outer (nested.ts:1)');
  expect(result.stdout).toContain('call nested.ts:2:1');
});
