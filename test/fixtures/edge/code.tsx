export function Widget(): null { return null; }
export const arrow = (value: number): number => value + 1;
export default function (): string { return 'default'; }

export function overloaded(value: string): string;
export function overloaded(value: number): number;
export function overloaded(value: string | number): string | number { return value; }

const object = {
  method(): string { return 'method'; },
};
object['method']();
overloaded('value');
arrow(1);
const view = <Widget />;
const renamed = arrow;
renamed(2);

function invoke(callback: () => void): void { callback(); }
declare const dynamic: any;
dynamic.run();
declare const path: string;
import(path);

function same(): void {}
function outer(): void {
  function same(): void {}
  same();
}

function recursive(): void { recursive(); }
throw new Error('EXAMPLE: scanned source must never execute');
