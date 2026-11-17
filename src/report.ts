import { findings, usages } from './query.ts';
import type { Inventory, Usage } from './model.ts';

/** Render a concise scan summary, including limitations affecting its findings. */
export function summary(inventory: Inventory): string {
  const analyzed = inventory.files.filter((file) => file.status === 'analyzed').length;
  const calls = inventory.references.filter((reference) => reference.kind === 'call').length;
  const candidates = findings(inventory);
  return (
    [
      `Code inventory: ${analyzed} analyzed files, ${inventory.symbols.length} symbols`,
      `${inventory.references.length} references, ${calls} direct call sites`,
      `${candidates.filter((finding) => finding.kind === 'no-references-found').length} symbols with no references found`,
      `${candidates.filter((finding) => finding.kind === 'exported-without-local-usage').length} exports without local usage`,
      `Analysis: ${inventory.completeness}; ${inventory.diagnostics.length} diagnostics`,
      'Static evidence only; no-reference findings are not proof of dead code.',
    ].join('\n') + '\n'
  );
}

/** Render one symbol's usages with source locations and reference kinds. */
export function usageText(usage: Usage): string {
  return (
    [
      `${usage.symbol.name} (${usage.symbol.id})`,
      `${usage.counts.references} references; ${usage.counts.directCallSites} direct call sites; ${usage.counts.distinctCallers} distinct callers`,
      ...usage.references.map(
        (reference) =>
          `${reference.location.file}:${reference.location.line}:${reference.location.column} ${reference.kind} [${reference.scope}]`,
      ),
    ].join('\n') + '\n'
  );
}

/** Escape source-controlled content before inserting it into Markdown tables. */
function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replaceAll('\n', ' ');
}

/** Generate a standalone report from the same snapshot used by library queries. */
export function markdown(inventory: Inventory): string {
  const rows = inventory.symbols.map((symbol) => {
    const usage = usages(inventory, symbol.id);
    return `| ${escape(symbol.name)} | ${symbol.kind} | ${escape(symbol.location.file)}:${symbol.location.line} | ${usage.counts.references} | ${usage.counts.directCallSites} | ${symbol.scope} |`;
  });
  const candidates = findings(inventory).map((finding) => {
    const symbol = inventory.symbols.find((item) => item.id === finding.symbolId)!;
    return `- ${escape(symbol.name)} (${escape(symbol.location.file)}:${symbol.location.line}): ${finding.message}${finding.uncertainty ? ' Analysis has unresolved evidence.' : ''}`;
  });
  return [
    '# Code inventory',
    '',
    `Snapshot: ${inventory.snapshotId}`,
    '',
    '```text',
    summary(inventory).trimEnd(),
    '```',
    '',
    '## Symbols',
    '',
    '| Symbol | Kind | Location | References | Direct calls | Scope |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...rows,
    '',
    '## Findings',
    '',
    ...(candidates.length ? candidates : ['No absent-reference findings.']),
    '',
    '## Diagnostics',
    '',
    ...(inventory.diagnostics.length
      ? inventory.diagnostics.map(
          (diagnostic) =>
            `- ${diagnostic.code}${diagnostic.location ? ` at ${escape(diagnostic.location.file)}:${diagnostic.location.line}` : ''}: ${escape(diagnostic.message)}`,
        )
      : ['No diagnostics.']),
    '',
    '## Analysis boundaries',
    '',
    ...inventory.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
}
