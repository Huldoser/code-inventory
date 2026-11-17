import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { scan, usages, findings } from '../src/index.ts';

const fixture = (name: string): string => resolve(import.meta.dirname, 'fixtures', name);

describe('analysis boundaries', () => {
  const edge = scan(fixture('edge'));

  it('counts a literal element-access call once without an extra read', () => {
    const usage = usages(edge, 'method');
    expect(usage.references.map((reference) => reference.kind)).toEqual(['call']);
  });

  it('records overload implementations once and resolves their call sites', () => {
    expect(edge.symbols.filter((symbol) => symbol.name === 'overloaded')).toHaveLength(1);
    expect(usages(edge, 'overloaded').counts.directCallSites).toBe(1);
  });

  it('resolves named arrow functions and immutable aliases', () => {
    expect(usages(edge, 'arrow').counts.directCallSites).toBe(2);
  });

  it('reports JSX references separately from direct call sites', () => {
    expect(usages(edge, 'Widget').references.map((reference) => reference.kind)).toEqual(['jsx']);
  });

  it('identifies anonymous default exports', () => {
    expect(usages(edge, 'default').symbol.exportedAs).toContain('code.tsx#default');
  });

  it('keeps unresolved callbacks and dynamic dependencies visible', () => {
    expect(edge.completeness).toBe('partial');
    expect(edge.diagnostics.filter((diagnostic) => diagnostic.code === 'unresolved-call')).toHaveLength(2);
    expect(edge.diagnostics.some((diagnostic) => diagnostic.code === 'dynamic-module')).toBe(true);
    expect(findings(edge).every((finding) => finding.uncertainty)).toBe(true);
  });

  it('requires a declaration ID when names are ambiguous', () => {
    expect(() => usages(edge, 'same')).toThrow('Ambiguous symbol');
    const matches = edge.symbols.filter((symbol) => symbol.name === 'same');
    expect(matches.map((symbol) => usages(edge, symbol.id).counts.directCallSites).sort()).toEqual([0, 1]);
    expect(() => usages(edge, 'nonexistent')).toThrow('Symbol not found');
  });

  it('does not mistake recursive references for proof of reachability', () => {
    expect(usages(edge, 'recursive').counts.directCallSites).toBe(1);
    expect(edge.limitations).toContain('References describe source occurrences, not execution counts or reachability.');
  });

  it('resolves CommonJS destructured imports and exports without executing source', () => {
    const js = scan(fixture('javascript'));
    expect(usages(js, 'clean').counts.directCallSites).toBe(1);
    expect(usages(js, 'clean').symbol.exportedAs).toContain('library.cjs#clean');
    expect(usages(js, 'Panel').references.map((reference) => reference.kind)).toEqual(['jsx']);
  });

  it('honors path mappings and accounts for config-excluded source', () => {
    const paths = scan(fixture('paths'));
    expect(usages(paths, 'target').counts.directCallSites).toBe(1);
    expect(paths.files.find((file) => file.path === 'excluded.ts')).toMatchObject({
      status: 'excluded',
      reason: 'project-config',
    });
    expect(paths.modules[0]?.resolvedFile).toBe('src/target.ts');
    expect(paths.diagnostics).toEqual([]);
  });

  it('reports parse and configuration errors as incomplete analysis', () => {
    const invalid = scan(fixture('invalid'));
    expect(invalid.completeness).toBe('partial');
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.location?.file === 'tsconfig.json')).toBe(true);
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.location?.file === 'broken.ts')).toBe(true);
  });

  it('links construction sites to explicit constructors as well as their classes', () => {
    const members = scan(fixture('members'));
    expect(usages(members, 'constructor').counts.constructorSites).toBe(1);
  });

  it('reports accessors as unresolved instead of assigning getter reads to setters', () => {
    const members = scan(fixture('members'));
    const accessors = members.symbols.filter((symbol) => symbol.name === 'value');
    expect(accessors).toHaveLength(2);
    expect(accessors.every((symbol) => usages(members, symbol.id).counts.references === 0)).toBe(true);
    expect(members.diagnostics.some((diagnostic) => diagnostic.code === 'accessor-dispatch')).toBe(true);
  });

  it('does not attribute a mutable function binding to its original initializer', () => {
    const members = scan(fixture('members'));
    expect(usages(members, 'mutable').counts.directCallSites).toBe(0);
    expect(members.diagnostics.some((diagnostic) => diagnostic.code === 'unresolved-call')).toBe(true);
  });
});
