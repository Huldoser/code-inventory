import { posix } from 'node:path';
import type { CodeSymbol, Inventory, Location, ModuleReference } from './model.ts';

type Step = {
  from: string;
  kind: ModuleReference['kind'] | 'call' | 'construct';
  location: Location;
};

export interface Reachability {
  snapshotId: string;
  entries: string[];
  completeness: Inventory['completeness'];
  diagnostics: Inventory['diagnostics'];
  /** One shortest-path predecessor per reached module or declaration. Roots have no predecessor. */
  reached: { id: string; via: Step | null }[];
  declarations: { id: string; name: string; location: Location; status: 'reachable' | 'no-known-path' }[];
  limitations: string[];
}

const moduleId = (file: string) => 'module:' + file;

/** Trace resolved direct calls, construction and literal module edges from selected source files. */
export function reachability(
  inventory: Inventory,
  files: readonly string[],
  options: { entryGlobs?: readonly string[] } = {},
): Reachability {
  const selected = new Set(files.map((file) => posix.normalize(file)));
  const analyzed = new Set(inventory.files.filter((file) => file.status === 'analyzed').map((file) => file.path));
  for (const glob of options.entryGlobs ?? []) {
    const pattern = glob.replace(/^\.\//, '');
    const matches = [...analyzed].filter((file) => posix.matchesGlob(file, pattern));
    if (!matches.length) throw new Error('No analyzed entry files match: ' + glob);
    for (const file of matches) selected.add(file);
  }
  const entries = [...selected].sort();
  if (!entries.length) throw new Error('Select at least one entry file.');
  for (const file of entries) {
    if (!analyzed.has(file)) throw new Error('Entry file was not analyzed: ' + file);
  }

  const edges = new Map<string, { to: string; via: Step }[]>();
  function connect(to: string, via: Step): void {
    const list = edges.get(via.from);
    if (list) list.push({ to, via });
    else edges.set(via.from, [{ to, via }]);
  }
  for (const ref of inventory.references) {
    if (ref.kind === 'call' || ref.kind === 'construct') {
      connect(ref.targetId, {
        from: ref.callerId ?? moduleId(ref.location.file),
        kind: ref.kind,
        location: ref.location,
      });
    }
  }
  // Older snapshots lack the containing declaration on module edges.
  const byFile = new Map<string, CodeSymbol[]>();
  for (const dep of inventory.modules) {
    if (dep.typeOnly || !dep.resolvedFile || !analyzed.has(dep.resolvedFile)) continue;
    let caller = dep.callerId;
    if (caller === undefined && (dep.kind === 'require' || dep.kind === 'dynamic-import')) {
      let symbols = byFile.get(dep.location.file);
      if (!symbols) {
        symbols = inventory.symbols
          .filter((s) => s.location.file === dep.location.file)
          .sort((a, b) => a.location.end - a.location.start - (b.location.end - b.location.start));
        byFile.set(dep.location.file, symbols);
      }
      caller = symbols.find((s) => s.location.start <= dep.location.start && dep.location.end <= s.location.end)?.id;
    }
    connect(moduleId(dep.resolvedFile), {
      from: caller ?? moduleId(dep.location.file),
      kind: dep.kind,
      location: dep.location,
    });
  }

  const queue = entries.map(moduleId);
  const paths = new Map<string, Step | null>(queue.map((id) => [id, null]));
  for (let index = 0; index < queue.length; index++) {
    for (const { to, via } of edges.get(queue[index]!) ?? []) {
      if (paths.has(to)) continue;
      paths.set(to, via);
      queue.push(to);
    }
  }
  return {
    snapshotId: inventory.snapshotId,
    entries,
    completeness: inventory.completeness,
    diagnostics: inventory.diagnostics,
    reached: [...paths].map(([id, via]) => ({ id, via })),
    declarations: inventory.symbols
      .filter((s) => ['class', 'constructor', 'function', 'method'].includes(s.kind))
      .map((s) => ({
        id: s.id,
        name: s.name,
        location: s.location,
        status: paths.has(s.id) ? 'reachable' : 'no-known-path',
      })),
    limitations: [
      'Paths follow resolved direct calls, construction and source module edges. Conditional code can contribute a path.',
      'Callbacks, external API consumers, framework dispatch, class initialization and computed imports can hide paths.',
      'No known path is relative to the selected entries and supported edges. Runtime execution is unknown.',
    ],
  };
}

/** Return one shortest path in entry-to-target order, or null for an unreached ID. */
export function entryPath(report: Reachability, id: string): Reachability['reached'] | null {
  const nodes = new Map(report.reached.map((node) => [node.id, node]));
  let node = nodes.get(id);
  if (!node) return null;
  const path = [node];
  while (node.via) {
    const parent = nodes.get(node.via.from);
    if (!parent || path.length >= nodes.size) throw new Error('Invalid reachability predecessor chain.');
    path.push(parent);
    node = parent;
  }
  return path.reverse();
}
