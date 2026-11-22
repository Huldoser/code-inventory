// @ts-check
import codec from './index.js';

codec.encode(42);
const transform = codec.encode;
transform('invalid argument');
codec.hidden();
