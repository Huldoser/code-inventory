# code-inventory

Inventory JavaScript and TypeScript declarations and find their source references without running the scanned code.

The library and CLI produce versioned JSON snapshots, usage queries, terminal summaries, and Markdown reports.
This initial implementation is not published as an npm package.

## Use

Run these commands from the package directory using Node 26.13.1, the version pinned for CI:

```sh
npm ci --ignore-scripts --no-audit
npm run build
node dist/cli.js test/fixtures/basic
node dist/cli.js test/fixtures/basic --symbol normalize
node dist/cli.js test/fixtures/basic --format json
node dist/cli.js test/fixtures/basic --format markdown
node dist/cli.js . --project tsconfig.build.json --exclude '**/generated/**' --test 'qa/**'
```

The optional directory argument defaults to the current directory. `--output` writes to a new file and refuses to
overwrite an existing file. `--strict` returns exit code 2 when the result contains analysis diagnostics; the report
is still produced. Invalid arguments and filesystem errors return exit code 1.

An exact symbol name is accepted only when it identifies one declaration. For ambiguous names, use the ID printed in
the snapshot or the error message. Selected-symbol JSON includes snapshot identity, diagnostics and completeness.

```ts
import { scan, usages, findings, markdown } from 'code-inventory';

const inventory = scan(projectDirectory);
const usage = usages(inventory, symbolId);
const candidates = findings(inventory);
const report = markdown(inventory);
```

The library API is synchronous. A scan reads source, package metadata and compiler configuration, without executing
application modules, configuration scripts or tests. JSON output excludes source bodies and the absolute root path.

## What is counted

- **References:** resolved occurrences, categorized as calls, construction, reads, type references, imports,
  re-exports, or JSX. An import/re-export alias is counted once. References include import syntax even if the binding
  is never used; use the reference kind when interpreting totals.
- **Direct call sites:** resolved call expressions in source. A call inside a loop remains one site.
- **Construction sites:** `new` expressions. An explicit constructor and its class each receive a relationship;
  summing relationships across symbols is not a count of unique source sites.
- **Distinct callers:** containing declarations, with top-level code grouped by source module.
- **Callbacks:** passing a function as a value is a reference, not a direct invocation of that function.

Scope labels use path conventions. `test`, `tests`, `__tests__`, `__mocks__`, `fixtures`, and `.test`/`.spec` files are
test scope. `scripts`, `tools` and `*.config.*` are tooling scope. Everything else is production scope. These labels
are heuristics, not framework-derived configuration.

## Findings and limits

`findings()` separates local declarations with no discovered usage from exported declarations without local usage.
Imports and re-export syntax alone do not count as meaningful usage for these findings. Export visibility means an
export exists somewhere in analyzed source, not necessarily that it is in a package's public entry point.

Neither finding proves that code is unused. This version does not analyze entry-point reachability, so recursion and
mutually referring declarations can have references while remaining unreachable. It does not infer runtime execution
counts or whether tests exercise behavior.

Supported inputs include TS, TSX, JS, JSX, MTS, CTS, MJS and CJS. The root `tsconfig.json` or `jsconfig.json` supplies
compiler options, include/exclude selection and path aliases. Imported source can still enter the program when it is
excluded from the root file list, as with the compiler itself. Without a configuration, discovered source is scanned.

Discovery does not follow symlinks or enter `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.nuxt` or
`.output`. Declaration files are excluded from the inventory, though compiler resolution may read them. Discovered
source files excluded by project configuration or declaration-file status are listed with a reason. Ignored directory
contents and non-source files are outside the discovery scope. Use repeated `--project` arguments to select config files relative to the scan root. Each selected
config and its transitive project references use their own compiler options. A solution config with an empty
`files` list can select an entire reference graph.

Each analyzed file contributes its declarations and usages once. When multiple configs explicitly include a file,
the config with the shortest relative path to that file owns it. Config path order breaks ties. Imported files
outside all root lists use the first importing project in config path order. The file record names the owner.
For a shared file whose aliases resolve differently between projects, scan each project separately to inspect
the alternative interpretation.

`--exclude` removes matching files from the inventory even when imported. `--test`, `--tooling` and `--production`
override scope conventions in that order. Each accepts repeatable, quoted globs matching slash-separated paths
relative to the scan root. The same options are available through `scan(root, { projects, exclude, scopes })`,
where `scopes` maps each scope name to an array of globs.

Diagnostics identify parse errors, unresolved imports/calls, computed module paths, accessors and mutable function
bindings. Accessor declarations are listed, but implicit getter/setter dispatch is not resolved. Runtime mutation,
reflection, framework conventions and unsupported alias patterns can hide usages. Consumers should inspect both the
diagnostics and these limits; `complete` only means no diagnostics were generated within the supported analysis.

Snapshots hash discovered source and the files read while parsing compiler configuration, including inherited
configs. JSON records the selected entries, the project graph's config paths and those input hashes.
Installed declarations and package metadata used only for source module resolution are outside this fingerprint. Snapshot IDs identify
the resulting report; they are not an incremental-cache key covering every input. Symbol IDs use declaration locations
and are only stable within an unchanged snapshot. Offsets are zero-based UTF-16; lines and columns are one-based.

The adapter uses Microsoft's TypeScript 6 compatibility package, whose resolved engine is 6.0.3. Syntax or project
settings requiring newer compiler APIs may produce incomplete results. The supported runtime is Node 26 or newer; CI uses the version in `.node-version`.

## Development

```sh
npm run check
osv-scanner scan source --offline -L package-lock.json
```

`check` type-checks source and tests, builds the library and CLI, runs ESLint and Vitest, and verifies formatting.
The CI workflow also retains the template's actionlint and zizmor checks, and its required `ci` job depends on all checks. The tests include scanned fixtures
that throw if executed, known counts for aliases and callbacks, shadowed names, CommonJS, JSX, overloads, path mappings,
partial analysis, deterministic output, CLI/library agreement and refusal to overwrite existing files.

Tooling follows test-inventory where relevant: Vitest, ESLint, Prettier and TypeScript. The analysis backend uses the
compiler's symbol resolver rather than adding a second syntax parser. There is no integration with test-inventory,
MCP server, framework plugin system or entry-point unused-code engine in this milestone.

MIT licensed; see [LICENSE](LICENSE). Dependency licenses are recorded in [THIRD_PARTY.md](THIRD_PARTY.md).
