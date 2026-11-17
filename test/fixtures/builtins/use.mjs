import { join } from 'node:path';
import { readFileSync } from 'fs';
import 'EXAMPLE-unresolved-package';
join('a', 'b');
readFileSync('EXAMPLE');
