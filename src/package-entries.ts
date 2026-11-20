import ts from 'typescript';
import type { Inventory } from './model.ts';
import { loadProjects } from './projects.ts';
import { portablePath } from './discovery.ts';
import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';

/** Collect explicit runtime entry files from one package, across its declared conditions. */
export function packageEntries(directory: string, inventory: Inventory): string[] {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const files = new Set<string>();
  function add(target: unknown): void {
    if (
      typeof target !== 'string' ||
      !target ||
      target.includes('*') ||
      posix.isAbsolute(target) ||
      target.includes('\\') ||
      target.split('/').includes('..')
    ) {
      throw new Error('Package entry requires an explicit local source path. Use --entry to select it.');
    }
    if (/\.json$/.test(target)) return;
    if (!/\.d\.[cm]?ts$/.test(target)) files.add(posix.normalize(target));
  }
  function collect(target: unknown): void {
    if (target === null) return;
    if (Array.isArray(target)) {
      for (const item of target) collect(item);
    } else if (typeof target === 'object') {
      for (const [condition, value] of Object.entries(target)) {
        if (condition !== 'types' && !condition.startsWith('types@')) collect(value);
      }
    } else add(target);
  }
  if ('exports' in manifest) collect(manifest.exports);
  else if ('main' in manifest) add(manifest.main);
  if (typeof manifest.bin === 'string') add(manifest.bin);
  else if (manifest.bin) Object.values(manifest.bin).forEach(add);
  if (!files.size) throw new Error('No explicit package entries. Select a source file with --entry.');
  const analyzed = new Set(inventory.files.filter((file) => file.status === 'analyzed').map((file) => file.path));
  if ([...files].every((file) => analyzed.has(file))) return [...files].sort();
  const sources = new Map<string, Set<string>>();
  for (const project of loadProjects(directory, inventory.config.entries).ordered) {
    if (!project.path || project.options.noEmit || project.options.emitDeclarationOnly) continue;
    const config = { options: project.options, fileNames: [...project.files], errors: [] };
    for (const input of project.files) {
      const source = portablePath(directory, input);
      if (!analyzed.has(source)) continue;
      for (const output of ts.getOutputFileNames(config, input, !ts.sys.useCaseSensitiveFileNames)) {
        const path = portablePath(directory, output);
        if (!files.has(path)) continue;
        const candidates = sources.get(path) ?? new Set<string>();
        candidates.add(source);
        sources.set(path, candidates);
      }
    }
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
