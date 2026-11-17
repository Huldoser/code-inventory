import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { scan, usages, findings, markdown } from '../src/index.ts';

const root = resolve(import.meta.dirname, 'fixtures/basic');
const inventory = scan(root);

describe('symbol inventory', () => {
  it('discovers functions, methods, classes and types with portable source locations', () => {
    expect(inventory.files.filter((file) => file.status === 'analyzed')).toHaveLength(4);
    expect(inventory.symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual(
      expect.arrayContaining([
        ['normalize', 'function'],
        ['format', 'method'],
        ['Formatter', 'class'],
        ['FormatOptions', 'type'],
      ]),
    );
    expect(inventory.symbols.every((symbol) => !symbol.location.file.startsWith('/'))).toBe(true);
    expect(inventory.diagnostics).toEqual([]);
  });

  it('resolves renamed imports and re-exports to the original function', () => {
    const usage = usages(inventory, 'normalize');
    expect(usage.counts.directCallSites).toBe(4);
    expect(
      usage.references.filter((reference) => reference.kind === 'call').map((reference) => reference.location.file),
    ).toEqual(['app.ts', 'app.ts', 'definitions.ts', 'spec.test.ts']);
    expect(usage.symbol.exportedAs).toContain('barrel.ts#clean');
    expect(usage.counts.distinctCallers).toBe(3);
    expect(usage.references.filter((reference) => reference.kind === 'reexport')).toHaveLength(1);
  });

  it('counts callbacks as references rather than calls and separates test usage', () => {
    const usage = usages(inventory, 'normalize');
    expect(usage.references.filter((reference) => reference.kind === 'read')).toHaveLength(2);
    expect(
      usage.references.filter((reference) => reference.kind === 'call' && reference.scope === 'test'),
    ).toHaveLength(1);
  });

  it('keeps a shadowed function separate from an imported name', () => {
    const usage = usages(inventory, 'clean');
    expect(usage.counts.directCallSites).toBe(1);
    expect(usage.symbol.location.file).toBe('app.ts');
  });

  it('resolves methods and distinguishes constructor calls', () => {
    expect(usages(inventory, 'format').counts.directCallSites).toBe(1);
    expect(usages(inventory, 'Formatter').counts.constructorSites).toBe(1);
    expect(usages(inventory, 'Formatter').counts.directCallSites).toBe(0);
  });

  it('reports unused local declarations separately from exports', () => {
    const byName = new Map(
      findings(inventory).map((finding) => [
        inventory.symbols.find((symbol) => symbol.id === finding.symbolId)?.name,
        finding.kind,
      ]),
    );
    expect(byName.get('unused')).toBe('no-references-found');
    expect(byName.get('publicOnly')).toBe('exported-without-local-usage');
    expect(byName.has('normalize')).toBe(false);
  });

  it('produces identical snapshots and Markdown for identical inputs', () => {
    const second = scan(root);
    expect(second).toEqual(inventory);
    expect(markdown(second)).toEqual(markdown(inventory));
    expect(markdown(inventory)).toContain('not proof of dead code');
  });
});
