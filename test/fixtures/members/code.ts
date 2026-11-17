export class Box {
  constructor() {}
  get value(): number { return 1; }
  set value(value: number) {}
}

const box = new Box();
box.value;
box.value = 2;

let mutable = (): number => 1;
mutable = (): number => 2;
mutable();
