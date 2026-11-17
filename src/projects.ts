import ts from 'typescript';
import { existsSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { compare, hashFile, portablePath, scopeOf } from './discovery.ts';
import type { Scope } from './model.ts';

export interface ScanOptions {
  projects?: readonly string[];
  exclude?: readonly string[];
  scopes?: Partial<Record<Scope, readonly string[]>>;
}

export interface Project {
  path: string | null;
  files: Set<string>;
  options: ts.CompilerOptions;
  references: readonly ts.ProjectReference[];
}

export function fileRules(options: ScanOptions) {
  const matches = (file: string, patterns: readonly string[] = []) =>
    patterns.some((pattern) => posix.matchesGlob(file, pattern));
  return {
    excluded: (file: string) => matches(file, options.exclude),
    scope(file: string): Scope {
      for (const scope of ['test', 'tooling', 'production'] as const) {
        if (matches(file, options.scopes?.[scope])) return scope;
      }
      return scopeOf(file);
    },
  };
}

/** Read selected configurations and follow their project references without building them. */
export function loadProjects(root: string, requested: readonly string[] = []) {
  const paths = requested.length
    ? requested.map((path) => resolve(root, path))
    : ['tsconfig.json', 'jsconfig.json']
        .map((path) => resolve(root, path))
        .filter(existsSync)
        .slice(0, 1);
  const entries = [...new Set(paths)].sort(compare);
  const projects = new Map<string, Project>();
  const inputs = new Map<string, string>();
  const diagnostics: ts.Diagnostic[] = [];

  function load(path: string): void {
    if (projects.has(path)) return;
    const parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, {
      ...ts.sys,
      readFile(file) {
        const content = ts.sys.readFile(file);
        if (content !== undefined && !inputs.has(file)) inputs.set(file, hashFile(file));
        return content;
      },
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const project: Project = {
      path,
      files: new Set(parsed?.fileNames ?? []),
      options: parsed?.options ?? {},
      references: parsed?.projectReferences ?? [],
    };
    projects.set(path, project);
    diagnostics.push(...(parsed?.errors ?? []));
    for (const reference of project.references) load(ts.resolveProjectReferencePath(reference));
  }

  for (const entry of entries) {
    if (!existsSync(entry)) throw new Error('Project configuration does not exist: ' + portablePath(root, entry));
    load(entry);
  }
  const ordered = [...projects.values()].sort((a, b) => compare(a.path!, b.path!));
  if (!ordered.length) {
    ordered.push({
      path: null,
      files: new Set(),
      references: [],
      options: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        jsx: ts.JsxEmit.Preserve,
      },
    });
  }
  return {
    ordered,
    entries,
    diagnostics,
    inputs: [...inputs]
      .map(([path, hash]) => ({ path: portablePath(root, path), hash }))
      .sort((a, b) => compare(a.path, b.path)),
  };
}

/** Prefer the closest config that explicitly includes the file, breaking equal distances by config path. */
export function projectOwners(projects: Project[]): Map<string, Project> {
  const owners = new Map<string, Project>();
  const distance = (config: string, file: string) => portablePath(dirname(config), file).split('/').length;
  for (const project of projects) {
    for (const file of project.files) {
      const previous = owners.get(file);
      if (!previous || distance(project.path!, file) < distance(previous.path!, file)) owners.set(file, project);
    }
  }
  return owners;
}
