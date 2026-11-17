export function normalize(value: string): string {
  return value.trim();
}

export function publicOnly(): number {
  return 1;
}

function unused(): number {
  return 2;
}

export class Formatter {
  format(value: string): string {
    return normalize(value);
  }
}

export type FormatOptions = { upper: boolean };
