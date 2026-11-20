#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { packageEntries, reachability, scan, markdown, summary, usages, usageText } from './index.ts';

import { reachabilityText } from './report.ts';

/** Run a read-only scan; output files must be new paths to avoid overwriting user work. */
function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'package-entries': { type: 'boolean' },
      'entry-glob': { type: 'string', multiple: true },
      entry: { type: 'string', multiple: true },
      project: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      test: { type: 'string', multiple: true },
      tooling: { type: 'string', multiple: true },
      production: { type: 'string', multiple: true },
      format: { type: 'string', default: 'summary' },
      symbol: { type: 'string' },
      output: { type: 'string' },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: code-inventory [directory] [--entry source-file] [--entry-glob glob] [--package-entries] [--project config] [--exclude glob] [--test glob] [--tooling glob] [--production glob] [--format summary|json|markdown] [--symbol name-or-id] [--output new-file] [--strict]\n',
    );
    return;
  }
  if (positionals.length > 1) throw new Error('Provide at most one directory.');
  if (!['summary', 'json', 'markdown'].includes(values.format)) throw new Error(`Unknown format: ${values.format}`);
  const directory = positionals[0] ?? '.';
  const entryQuery = values.entry || values['entry-glob'] || values['package-entries'];
  if (values.symbol && entryQuery) throw new Error('Select either entry points or --symbol.');
  if (values.symbol && values.format === 'markdown') throw new Error('--symbol supports summary and json formats.');
  const inventory = scan(directory, {
    projects: values.project ?? [],
    exclude: values.exclude ?? [],
    scopes: { test: values.test ?? [], tooling: values.tooling ?? [], production: values.production ?? [] },
  });
  const entries = [...(values.entry ?? []), ...(values['package-entries'] ? packageEntries(directory, inventory) : [])];
  const paths = entryQuery ? reachability(inventory, entries, { entryGlobs: values['entry-glob'] ?? [] }) : null;
  const selected = values.symbol ? usages(inventory, values.symbol) : null;
  const output =
    values.format === 'json'
      ? JSON.stringify(
          selected
            ? {
                schemaVersion: inventory.schemaVersion,
                snapshotId: inventory.snapshotId,
                completeness: inventory.completeness,
                diagnostics: inventory.diagnostics,
                usage: selected,
              }
            : (paths ?? inventory),
          null,
          2,
        ) + '\n'
      : paths
        ? reachabilityText(paths, values.format === 'markdown')
        : selected
          ? usageText(selected) + `Analysis: ${inventory.completeness}; ${inventory.diagnostics.length} diagnostics\n`
          : values.format === 'markdown'
            ? markdown(inventory)
            : summary(inventory);
  if (values.output) writeFileSync(values.output, output, { flag: 'wx' });
  else process.stdout.write(output);
  if (values.strict && inventory.completeness === 'partial') process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`code-inventory: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
