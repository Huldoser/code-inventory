# Dependencies

| Package                                            | License    | Source                                                                                   |
| -------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| @typescript/typescript6; its typescript dependency | Apache-2.0 | https://github.com/microsoft/TypeScript                                                  |
| @types/node                                        | MIT        | https://github.com/DefinitelyTyped/DefinitelyTyped                                       |
| undici-types (Node type dependency)                | MIT        | https://github.com/nodejs/undici                                                         |
| vitest and its workspace packages                  | MIT        | https://github.com/vitest-dev/vitest                                                     |
| prettier                                           | MIT        | https://github.com/prettier/prettier                                                     |
| eslint and typescript-eslint                       | MIT        | https://github.com/eslint/eslint; https://github.com/typescript-eslint/typescript-eslint |

The lockfile records exact versions, integrity hashes and licenses for transitive dependencies. Installation uses
`--ignore-scripts`. The optional macOS-only fsevents package declares an install script and is not installed on Linux.

The compiler dependency is an npm alias to `@typescript/typescript6@6.0.2`, as documented by Microsoft for tooling that
requires the compiler API. That package resolves `typescript@6.0.3` internally.

Security check: typescript-eslint 8.72.2 would pull minimatch 10.2.6, affected by
[GHSA-g3hv-75wg-m249](https://osv.dev/GHSA-g3hv-75wg-m249). Version 8.73.0 changes the parser's minimatch requirement to
`^11.0.1`, and this lockfile resolves 11.0.8. The upgrade used command-scoped release-age exceptions for
typescript-eslint and its ten matching workspace packages, all exactly 8.73.0, published November 16, 2026.
The exception expires when those releases pass 24 hours on November 17, 2026. No npm configuration was changed;
a subsequent plain `npm ci --ignore-scripts --no-audit` succeeded with the lockfile. The offline npm database dated
November 16, 2026 reported no issues in the final graph.

This records dependency licenses only. No license for this project's own code has been selected yet.
