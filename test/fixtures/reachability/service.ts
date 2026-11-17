export function start() { leaf(); new Worker(); }
function leaf() {}
class Worker { constructor() { leaf(); } }
export function left() { right(); }
function right() { left(); }
export function deferred() { return import('./late'); }
