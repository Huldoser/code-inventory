import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { scan, usages } from '../src/index.ts';

const cli = resolve(import.meta.dirname, '../dist/cli.js');
const basic = resolve(import.meta.dirname, 'fixtures/basic');
const edge = resolve(import.meta.dirname, 'fixtures/edge');

/** Exercise the compiled entry point rather than the command's internal implementation. */
function run(...args: string[]) {
  return spawnSync(process.execPath, ['--max-old-space-size=2048', cli, ...args], { encoding: 'utf8', timeout: 10000 });
}

describe('CLI', () => {
  it('prints help without scanning a source directory', () => {
    const result = run('/EXAMPLE/nonexistent', '--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: code-inventory');
  });

  it('produces the same JSON snapshot as the library', () => {
    const result = run(basic, '--format', 'json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(scan(basic));
    expect(result.stderr).toBe('');
  });

  it('produces the same selected usages and snapshot identity as the library', () => {
    const result = run(basic, '--symbol', 'normalize', '--format', 'json');
    const inventory = scan(basic);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      snapshotId: inventory.snapshotId,
      usage: usages(inventory, 'normalize'),
    });
  });

  it('returns partial results with a distinct strict-mode exit code', () => {
    const result = run(edge, '--strict', '--format', 'json');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).completeness).toBe('partial');
  });

  it('rejects unknown options and invalid output formats', () => {
    expect(run(basic, '--format', 'wrong').status).toBe(1);
    expect(run(basic, '--unknown').status).toBe(1);
    expect(run(basic, '--symbol', 'normalize', '--format', 'markdown').status).toBe(1);
  });

  it('refuses to overwrite an existing source file', () => {
    const before = scan(basic).snapshotId;
    const result = run(basic, '--output', resolve(basic, 'app.ts'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('EEXIST');
    expect(scan(basic).snapshotId).toBe(before);
  });

  it('renders a standalone Markdown report', () => {
    const result = run(basic, '--format', 'markdown');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## Symbols');
    expect(result.stdout).toContain('## Analysis boundaries');
  });
});
