/** One-based source coordinates and zero-based UTF-16 offsets, end exclusive. */
export interface Location {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export type SymbolKind = 'function' | 'method' | 'constructor' | 'class' | 'interface' | 'type' | 'enum';
export type Scope = 'production' | 'test' | 'tooling';
export type ReferenceKind = 'call' | 'construct' | 'read' | 'type' | 'import' | 'reexport' | 'jsx';

/** IDs identify declarations within this snapshot, not across edits or moves. */
export interface CodeSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  location: Location;
  containerId: string | null;
  scope: Scope;
  exportedAs: string[];
}

/** A resolved source occurrence. Call sites do not represent invocation counts. */
export interface Reference {
  targetId: string;
  kind: ReferenceKind;
  location: Location;
  callerId: string | null;
  scope: Scope;
}

/** Module syntax is recorded even when its target cannot be resolved. */
export interface ModuleReference {
  specifier: string;
  kind: 'import' | 'export' | 'dynamic-import' | 'require';
  location: Location;
  typeOnly: boolean;
  resolvedFile: string | null;
}

export interface Export {
  file: string;
  name: string;
  targetId: string | null;
}

export interface Diagnostic {
  code: string;
  message: string;
  location: Location | null;
}

export interface SourceFile {
  path: string;
  hash: string;
  status: 'analyzed' | 'excluded';
  reason: string | null;
  project?: string;
}

/** A portable deterministic snapshot; source text and absolute root paths are omitted. */
export interface Inventory {
  schemaVersion: 1;
  analyzer: { name: 'code-inventory'; version: '0.1.0'; compilerVersion: string };
  snapshotId: string;
  config: {
    path: string | null;
    hash: string | null;
    entries?: string[];
    projects?: string[];
    inputs?: { path: string; hash: string }[];
  };
  completeness: 'complete' | 'partial';
  files: SourceFile[];
  symbols: CodeSymbol[];
  references: Reference[];
  modules: ModuleReference[];
  exports: Export[];
  diagnostics: Diagnostic[];
  limitations: string[];
}

export interface Usage {
  symbol: CodeSymbol;
  references: Reference[];
  counts: {
    references: number;
    directCallSites: number;
    constructorSites: number;
    distinctCallers: number;
    production: number;
    test: number;
    tooling: number;
  };
}

export interface Finding {
  symbolId: string;
  kind: 'no-references-found' | 'exported-without-local-usage';
  message: string;
  uncertainty: boolean;
}
