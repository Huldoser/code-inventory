import type { Finding, Inventory, Usage } from './model.ts';

/** Select by exact snapshot ID or by unambiguous declaration name. */
export function usages(inventory: Inventory, selector: string): Usage {
  const matches = inventory.symbols.filter((symbol) => symbol.id === selector || symbol.name === selector);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Symbol not found: ${selector}`
        : `Ambiguous symbol ${selector}; use one of these IDs:\n${matches.map((symbol) => symbol.id).join('\n')}`,
    );
  }
  const symbol = matches[0]!;
  const references = inventory.references.filter((reference) => reference.targetId === symbol.id);
  const calls = references.filter((reference) => reference.kind === 'call' || reference.kind === 'construct');
  return {
    symbol,
    references,
    counts: {
      references: references.length,
      directCallSites: references.filter((reference) => reference.kind === 'call').length,
      constructorSites: references.filter((reference) => reference.kind === 'construct').length,
      distinctCallers: new Set(calls.map((reference) => reference.callerId ?? `module:${reference.location.file}`))
        .size,
      production: references.filter((reference) => reference.scope === 'production').length,
      test: references.filter((reference) => reference.scope === 'test').length,
      tooling: references.filter((reference) => reference.scope === 'tooling').length,
    },
  };
}

/** Describe absent references without asserting dead code or runtime reachability. */
export function findings(inventory: Inventory): Finding[] {
  return inventory.symbols.flatMap((symbol) => {
    const meaningful = inventory.references.some(
      (reference) => reference.targetId === symbol.id && reference.kind !== 'import' && reference.kind !== 'reexport',
    );
    if (meaningful) return [];
    const exported = symbol.exportedAs.length > 0;
    return [
      {
        symbolId: symbol.id,
        kind: exported ? ('exported-without-local-usage' as const) : ('no-references-found' as const),
        message: exported
          ? 'Exported API with no usage found in analyzed source; external consumers are unknown.'
          : 'No usage found in analyzed source; this is not a dead-code verdict.',
        uncertainty: inventory.completeness === 'partial',
      },
    ];
  });
}
