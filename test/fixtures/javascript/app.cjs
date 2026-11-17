const { clean } = require('./library.cjs');
clean('value');
throw new Error('EXAMPLE: scanned JavaScript must never execute');
