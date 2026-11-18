export { scan } from './compiler.ts';
export { usages, findings } from './query.ts';
export { markdown, summary, usageText } from './report.ts';
export type {
  Inventory,
  CodeSymbol,
  Reference,
  ModuleReference,
  Diagnostic,
  Usage,
  Finding,
  Location,
} from './model.ts';
export type { ScanOptions } from './projects.ts';
export { reachability } from './reachability.ts';
export type { Reachability } from './reachability.ts';
