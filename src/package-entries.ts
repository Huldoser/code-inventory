import ts from 'typescript';
import type { Inventory } from './model.ts';
import { loadProjects } from './projects.ts';
import { portablePath } from './discovery.ts';
import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';

/** Node substitutes the same nonempty subpath for every star in a target, including across directories. */
function capture(parts: string[], path: string): string | null {
  if (!path.startsWith(parts[0]!)) return null;
  const literals = parts.reduce((length, part) => length + part.length, 0);
  const length = (path.length - literals) / (parts.length - 1);
  if (length < 1 || !Number.isInteger(length)) return null;
  const value = path.slice(parts[0]!.length, parts[0]!.length + length);
  return parts.join(value) === path ? value : null;
}

type ExportPattern = { key: string; target: string };

function* expandPatterns(patterns: ExportPattern[], subpaths: string[], candidates: Set<string>) {
  const exact = new Set(subpaths.filter((key) => !key.includes('*')));
  // Node selects the longest prefix first, then the longest complete pattern.
  const wildcardKeys = subpaths
    .filter((key) => key.includes('*'))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  const keys = wildcardKeys.map((key) => ({ key, parts: key.split('*') }));
  if (keys.some(({ parts }) => parts.length !== 2)) throw new Error('An export subpath pattern must contain one star.');
  for (const { key, target } of patterns) {
    const parts = target.split('*');
    let matched = false;
    for (const path of candidates) {
      const value = capture(parts, path);
      if (value === null) continue;
      matched = true;
      const subpath = key.replace('*', () => value);
      if (exact.has(subpath)) continue;
      const winner = keys.find(({ parts }) => capture(parts, subpath) !== null);
      if (winner?.key === key) yield path;
    }
    if (!matched)
      throw new Error(
        'No analyzed source or compiler output matches package target: ' +
          target +
          '. Select the build config with --project or use --entry.',
      );
  }
}

/** Collect explicit runtime entry files from one package, across its declared conditions. */
export function packageEntries(directory: string, inventory: Inventory): string[] {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const files = new Set<string>();
  const patterns: ExportPattern[] = [];
  const exports = manifest.exports;
  const subpaths =
    exports && typeof exports === 'object' && Object.keys(exports).some((key) => key.startsWith('.'))
      ? Object.keys(exports)
      : [];
  function add(target: unknown, key = ''): void {
    if (
      typeof target !== 'string' ||
      !target ||
      (target.includes('*') && !key.includes('*')) ||
      posix.isAbsolute(target) ||
      target.includes('\\') ||
      target.split('/').includes('..')
    ) {
      throw new Error('Package entry requires an explicit local source path. Use --entry to select it.');
    }
    if (/\.json$|\.d\.[cm]?ts$/.test(target)) return;
    const path = posix.normalize(target);
    if (path.includes('*')) patterns.push({ key, target: path });
    else files.add(path);
  }
  function collect(target: unknown, key = ''): void {
    if (target === null) return;
    if (Array.isArray(target)) {
      for (const item of target) collect(item, key);
    } else if (typeof target === 'object') {
      for (const [condition, value] of Object.entries(target)) {
        if (condition !== 'types' && !condition.startsWith('types@')) collect(value, key);
      }
    } else add(target, key);
  }
  if (subpaths.length) {
    for (const key of subpaths) collect(exports[key], key);
  } else if ('exports' in manifest) collect(exports);
  else if ('main' in manifest) add(manifest.main);
  if (typeof manifest.bin === 'string') add(manifest.bin);
  else if (manifest.bin) Object.values(manifest.bin).forEach((target) => add(target));
  const analyzed = new Set(inventory.files.filter((file) => file.status === 'analyzed').map((file) => file.path));
  if (!patterns.length) {
    if (!files.size) throw new Error('No explicit package entries. Select a source file with --entry.');
    if ([...files].every((file) => analyzed.has(file))) return [...files].sort();
  }
  const sources = new Map<string, Set<string>>();
  for (const project of loadProjects(directory, inventory.config.entries).ordered) {
    if (!project.path || project.options.noEmit || project.options.emitDeclarationOnly) continue;
    const config = { options: project.options, fileNames: [...project.files], errors: [] };
    for (const input of project.files) {
      const source = portablePath(directory, input);
      if (!analyzed.has(source)) continue;
      for (const output of ts.getOutputFileNames(config, input, !ts.sys.useCaseSensitiveFileNames)) {
        const path = portablePath(directory, output);
        if (!files.has(path) && !(patterns.length && /\.(?:[cm]?js|jsx)$/.test(path))) continue;
        const candidates = sources.get(path) ?? new Set<string>();
        candidates.add(source);
        sources.set(path, candidates);
      }
    }
  }
  if (patterns.length) {
    for (const file of expandPatterns(patterns, subpaths, new Set([...analyzed, ...sources.keys()]))) files.add(file);
    if (!files.size) throw new Error('No analyzed files are exposed by these package entries.');
  }
  const roots = new Set<string>();
  for (const file of files) {
    if (analyzed.has(file)) roots.add(file);
    else {
      const candidates = [...(sources.get(file) ?? [])];
      if (candidates.length !== 1)
        throw new Error(
          'Cannot map package entry to one analyzed source: ' +
            file +
            '. Select the build config with --project or use --entry.',
        );
      roots.add(candidates[0]!);
    }
  }
  return [...roots].sort();
}
