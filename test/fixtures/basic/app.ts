import { clean } from './barrel';
import { Formatter } from './definitions';
import type { FormatOptions } from './definitions';

function main(): void {
  clean(' first ');
  const alias = clean;
  alias(' second ');
  [' third '].map(clean);
  new Formatter().format(' fourth ');
  const options: FormatOptions = { upper: false };
}

function shadow(): string {
  function clean(value: string): string {
    return value;
  }
  return clean('inner');
}

main();
