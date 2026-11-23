import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { Scope } from './model.ts';

const excludedDirectories = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output']);
export const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Return sorted source paths without following symlinks or traversing build/dependency folders. */
export function discover(root: string): string[] {
  const files: string[] = [];
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) walk(path);
      else if (entry.isFile() && sourceExtension.test(entry.name)) files.push(path);
    }
  }
  walk(root);
  return files;
}

/** Normalize output paths independently of the host's directory separator. */
export function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

/** Hash exact bytes so snapshots can detect source changes. */
export function hashFile(path: string): string {
  return hash(readFileSync(path));
}

/** Hash content with a portable SHA-256 identifier. */
export function hash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Classify source roles by documented path conventions, without executing configuration. */
export function scopeOf(path: string): Scope {
  if (/(^|\/)(?:test|tests|__tests__|__mocks__|fixtures)(\/|$)|\.(?:test|spec)\.[^.]+$/.test(path)) return 'test';
  if (/(^|\/)(?:scripts|tools)(\/|$)|(?:^|\/)[^/]+\.config\.[^.]+$/.test(path)) return 'tooling';
  return 'production';
}

/** Use code-unit ordering so sorting is independent of machine locale. */
export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
