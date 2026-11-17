#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { scan, markdown, summary, usages, usageText } from './index.ts';

/** Run a read-only scan; output files must be new paths to avoid overwriting user work. */
function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: 'string', default: 'summary' },
      symbol: { type: 'string' },
      output: { type: 'string' },
      strict: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: code-inventory [directory] [--format summary|json|markdown] [--symbol name-or-id] [--output new-file] [--strict]\n',
    );
    return;
  }
  if (positionals.length > 1) throw new Error('Provide at most one directory.');
  if (!['summary', 'json', 'markdown'].includes(values.format)) throw new Error(`Unknown format: ${values.format}`);
  if (values.symbol && values.format === 'markdown') throw new Error('--symbol supports summary and json formats.');
  const inventory = scan(positionals[0] ?? '.');
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
            : inventory,
          null,
          2,
        ) + '\n'
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
