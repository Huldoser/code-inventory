# <img src="docs/assets/mark.svg" alt="" width="40" height="40"> code-inventory

Find where JavaScript and TypeScript declarations are used. The CLI and library resolve references through imports and aliases, distinguish direct calls from other reads, and trace paths from source entry points. Scanning reads the project without running its code.

## Run your first scan

In a JavaScript or TypeScript project with Node.js 26 or newer:

```sh
npm install --save-dev code-inventory
npx code-inventory .
```

For a checkout of this repository, use the fixture to check how calls are counted. CI uses the version in [.node-version](.node-version).

```sh
npm ci --ignore-scripts --no-audit
npm run build
node dist/cli.js test/fixtures/basic --symbol normalize
```

The [fixture](test/fixtures/basic/app.ts) calls `normalize` through the imported name `clean`, assigns it to another variable, and passes it to an array callback. The first two lines of the result are:

```text
normalize (definitions.ts:0:function)
9 references; 4 direct call sites; 3 distinct callers
```

The lines that follow identify each reference by file, line, column, kind, and scope. The callback argument on line 9 appears as a read. For a name shared by multiple declarations, query one of the IDs in the ambiguity message.

## Choose a report

| Question                              | Command from the repository root                                             |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| What declarations are in the fixture? | `node dist/cli.js test/fixtures/basic`                                       |
| What can the application entry reach? | `node dist/cli.js test/fixtures/basic --entry app.ts --format markdown`      |
| How do I save the full snapshot?      | `node dist/cli.js test/fixtures/basic --format json --output inventory.json` |
| How do I scan one TypeScript project? | `node dist/cli.js . --project tsconfig.build.json`                           |

For convention-based entry points, use a quoted pattern such as `--entry-glob 'src/routes/**/+page.ts'`. Combine it with `--package-entries` to include a package’s public entry files.

To review what an external caller can reach by invoking a handler, use `--entry-symbol GET`. If several declarations share that name, the CLI lists their snapshot IDs. File entries trace module initialization. Combining both options includes both starting points.

Repeat `--entry` to combine entry points or `--project` to select multiple configs. Output files must be new. Use `--strict` when a partial result should set exit code 2. The CLI still produces the report.

Check diagnostics before interpreting counts. Call sites measure source occurrences. Runtime dispatch, callbacks, and external consumers can introduce paths the scanner cannot see. Review declarations with no known path before considering removal.

## Use the library

From an ES module in a project with the package installed:

```js
import { scan, usages, reachability } from 'code-inventory';

// For a project with an app.ts entry and a normalize declaration:
const inventory = scan('.');
const usage = usages(inventory, 'normalize');
const paths = reachability(inventory, ['app.ts']);
```

## Documentation website

Open [the site home](docs/index.html) from a local checkout. The [guide](docs/guide.html) works through the fixture and shows how to [read a partial scan of the CLI](docs/guide.html#self-scan). The [reference](docs/reference.html) covers every CLI option, scope and project selection, snapshot fields, and analysis limits.

The site is static HTML and CSS with relative links. It opens directly from disk, and the [docs directory](docs/) can be served as a GitHub Pages publishing source.

## Development

```sh
npm run check
osv-scanner scan source --offline -L package-lock.json
```

The project check type-checks source and tests, builds the CLI and library, runs ESLint and Vitest, and checks formatting. CI also validates its workflows with actionlint and zizmor.

[MIT license](LICENSE) · [Dependency licenses](THIRD_PARTY.md)
