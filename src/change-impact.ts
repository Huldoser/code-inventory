import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import { sourceExtension } from './discovery.ts';
import type { CodeSymbol, Inventory, Reference } from './model.ts';

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', ['--literal-pathspecs', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function range(first: number, last: number): string {
  return first === last ? String(first) : `${first}-${last}`;
}

/** Check the part of a changed line belonging to the parent between nested declaration spans. */
function ownsText(source: string, parent: CodeSymbol, children: CodeSymbol[], start: number, end: number): boolean {
  let cursor = Math.max(start, parent.location.start);
  const limit = Math.min(end, parent.location.end);
  for (const child of children) {
    if (source.slice(cursor, Math.min(limit, child.location.start)).trim()) return true;
    cursor = Math.max(cursor, child.location.end);
  }
  return Boolean(source.slice(cursor, limit).trim());
}

/** Intersect Git's LF-delimited lines with the compiler's end-exclusive UTF-16 spans. */
function mapHunks(
  patch: string,
  file: string,
  source: string,
  declarations: CodeSymbol[],
  changed: Set<CodeSymbol>,
  notes: string[],
): void {
  const starts = [0];
  for (const newline of source.matchAll(/\n/g)) starts.push(newline.index + 1);
  declarations.sort((a, b) => a.location.start - b.location.start);
  let next = 0;
  let active: CodeSymbol[] = [];
  let hunks = 0;
  for (const hunk of patch.matchAll(/(?:^|\n)@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g)) {
    hunks++;
    const oldStart = Number(hunk[1]);
    const oldCount = Number(hunk[2] ?? 1);
    const first = Number(hunk[3]);
    const count = Number(hunk[4] ?? 1);
    if (oldCount) notes.push(`Removed base lines: ${file}:${range(oldStart, oldStart + oldCount - 1)}`);
    let outsideStart: number | undefined;
    // A pure deletion has a zero-width position between two surviving lines.
    for (let line = first; line < first + Math.max(1, count); line++) {
      const start = starts[count ? line - 1 : line] ?? source.length;
      const end = count ? (starts[line] ?? source.length) : start;
      while (next < declarations.length && declarations[next]!.location.start < end) {
        active.push(declarations[next++]!);
      }
      active = active.filter((symbol) => symbol.location.end > start);
      const children = groupBy(active, (symbol) => symbol.containerId);
      for (const symbol of active) {
        const nested = children.get(symbol.id);
        if (!nested || ownsText(source, symbol, nested, start, end)) changed.add(symbol);
      }
      if (count && !active.length) outsideStart ??= line;
      if (outsideStart !== undefined && (active.length || line === first + count - 1)) {
        notes.push(`Outside a declaration: ${file}:${range(outsideStart, active.length ? line - 1 : line)}`);
        outsideStart = undefined;
      }
    }
  }
  if (!hunks) notes.push(`No text hunks: ${file}`);
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function referenceGroups(references: Reference[], byId: Map<string, CodeSymbol>): string[] {
  const groups = new Map<string, { label: string; sites: string[] }>();
  for (const ref of references) {
    const { file, line, column } = ref.location;
    const caller = ref.callerId ? byId.get(ref.callerId) : undefined;
    const container = caller?.containerId ? byId.get(caller.containerId) : undefined;
    const label =
      ref.scope === 'test' ? file : caller ? [container?.name, caller.name].filter(Boolean).join('.') : file;
    const key = ref.scope === 'test' ? file : (ref.callerId ?? file);
    let group = groups.get(key);
    if (!group) {
      group = { label: `[${ref.scope}] ${label}`, sites: [] };
      groups.set(key, group);
    }
    group.sites.push(`${ref.kind} ${file}:${line}:${column}`);
  }
  return Array.from(groups.values(), ({ label, sites }) => `  ${label}: ${sites.join(', ')}`);
}

/** Compare a tree to the tracked working tree, resolving references only in the current inventory. */
export function changeImpactText(directory: string, base: string, inventory: Inventory): string {
  if (!base) throw new Error('Provide a Git revision for --changed-since.');
  const tree = git(directory, 'rev-parse', '--verify', '--end-of-options', base + '^{tree}').trim();
  const diff = ['diff', '--relative', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color'];
  const fields = git(directory, ...diff, '--name-status', '-z', tree, '--', '.').split('\0');
  const files = new Map(inventory.files.map((file) => [file.path, file]));
  const symbolsByFile = groupBy(inventory.symbols, (symbol) => symbol.location.file);
  const changed = new Set<CodeSymbol>();
  const notes: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i];
    const path = fields[i + 1]!;
    if (!sourceExtension.test(path)) continue;
    if (status === 'D') {
      notes.push(`Deleted file: ${path}`);
      continue;
    }
    const file = files.get(path);
    if (file?.status !== 'analyzed') {
      notes.push(`Outside scan: ${path} (${file?.reason ?? 'not inventoried'})`);
      continue;
    }
    const patch = git(directory, ...diff, '--unified=0', '--inter-hunk-context=0', tree, '--', path);
    const source = ts.sys.readFile(resolve(directory, path));
    if (source === undefined) throw new Error(`Cannot read changed file: ${path}`);
    mapHunks(patch, path, source, symbolsByFile.get(path) ?? [], changed, notes);
  }
  const byId = new Map(inventory.symbols.map((symbol) => [symbol.id, symbol]));
  const byTarget = groupBy(inventory.references, (ref) => ref.targetId);
  const lines = [`Change impact since ${base}`];
  for (const symbol of changed) {
    lines.push('', `${symbol.kind} ${symbol.name} (${symbol.location.file}:${symbol.location.line})`);
    if (symbol.exportedAs.length) lines.push(`  Exports: ${symbol.exportedAs.join(', ')}`);
    const groups = referenceGroups(byTarget.get(symbol.id) ?? [], byId);
    lines.push(...(groups.length ? groups : ['  No references found in this scan.']));
  }
  if (!changed.size && !notes.length) lines.push('No tracked source changes.');
  return [
    ...lines,
    ...notes,
    `Analysis: ${inventory.completeness}; ${inventory.diagnostics.length} diagnostics`,
    '',
  ].join('\n');
}
