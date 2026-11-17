import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { scan } from '../src/index.ts';

it('reports missing packages while recognizing Node built-in module specifiers', () => {
  const inventory = scan(resolve(import.meta.dirname, 'fixtures/builtins'));
  expect(inventory.modules.map((item) => item.specifier)).toEqual(['node:path', 'fs', 'EXAMPLE-unresolved-package']);
  expect(inventory.diagnostics.filter((item) => item.code === 'unresolved-module').map((item) => item.message)).toEqual(
    ['Module could not be resolved: EXAMPLE-unresolved-package'],
  );
});
