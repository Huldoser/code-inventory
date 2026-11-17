import ts from 'typescript';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compare, discover, hash, hashFile, portablePath, scopeOf } from './discovery.ts';
import type { CodeSymbol, Diagnostic, Inventory, Location, ReferenceKind, SymbolKind } from './model.ts';

const limitations = [
  'References describe source occurrences, not execution counts or reachability.',
  'Public exports may have consumers outside the scanned root.',
  'Reflection, framework conventions, mutable aliases and runtime dispatch may hide usages.',
  'Default discovery omits dependency/build directories and does not follow symlinks.',
  'Only the root tsconfig.json or jsconfig.json is used; project-reference builds are not performed.',
  'Symbol IDs are snapshot-local and may change when source locations change.',
];

/** Scan a project using the compiler API without emitting or executing project code. */
export function scan(rootDirectory: string): Inventory {
  const root = realpathSync(rootDirectory);
  const discovered = discover(root);
  const configPath = ['tsconfig.json', 'jsconfig.json'].map((name) => resolve(root, name)).find(existsSync);
  const diagnostics: Diagnostic[] = [];
  let selected = discovered.filter((path) => !/\.d\.[cm]?ts$/.test(path));
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.Preserve,
  };

  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) addCompilerDiagnostic(config.error);
    else {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
      for (const error of parsed.errors) addCompilerDiagnostic(error);
      options = parsed.options;
      const configured = new Set(parsed.fileNames.map((path) => resolve(path)));
      selected = selected.filter((path) => configured.has(path));
      if (parsed.projectReferences?.length) {
        diagnostics.push({
          code: 'project-references',
          message: 'Project references require separate scans; referenced projects are not built.',
          location: null,
        });
      }
      if (config.config.extends) {
        diagnostics.push({
          code: 'inherited-config',
          message:
            'Inherited compiler configuration is resolved, but its files are not fingerprinted in this snapshot.',
          location: null,
        });
      }
    }
  }

  // The compiler may resolve dependencies, but only discovered project sources enter the inventory.
  options = { ...options, noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true, types: options.types ?? [] };
  const program = ts.createProgram(selected, options);
  const checker = program.getTypeChecker();
  const discoveredSet = new Set(discovered);
  const sources = program
    .getSourceFiles()
    .filter((source) => discoveredSet.has(source.fileName) && !source.isDeclarationFile);
  sources.sort((a, b) => compare(a.fileName, b.fileName));
  const sourceSet = new Set(sources.map((source) => source.fileName));
  const symbols: CodeSymbol[] = [];
  const byNode = new Map<ts.Node, CodeSymbol>();
  const bySymbol = new Map<ts.Symbol, CodeSymbol>();
  const inventory: Inventory = {
    schemaVersion: 1,
    analyzer: { name: 'code-inventory', version: '0.1.0', compilerVersion: ts.version },
    snapshotId: '',
    config: {
      path: configPath ? portablePath(root, configPath) : null,
      hash: configPath ? hashFile(configPath) : null,
    },
    completeness: 'complete',
    files: discovered.map((path) => ({
      path: portablePath(root, path),
      hash: hashFile(path),
      status: sourceSet.has(path) ? 'analyzed' : 'excluded',
      reason: sourceSet.has(path) ? null : /\.d\.[cm]?ts$/.test(path) ? 'declaration-file' : 'project-config',
    })),
    symbols,
    references: [],
    modules: [],
    exports: [],
    diagnostics,
    limitations,
  };

  for (const source of sources) collectDeclarations(source, null);
  for (const source of sources) collectExports(source);
  for (const source of sources) visit(source, null);
  for (const diagnostic of program.getSyntacticDiagnostics()) addCompilerDiagnostic(diagnostic);
  for (const diagnostic of program.getOptionsDiagnostics()) addCompilerDiagnostic(diagnostic);
  for (const diagnostic of program.getSemanticDiagnostics()) {
    if (diagnostic.file && sourceSet.has(diagnostic.file.fileName)) addCompilerDiagnostic(diagnostic);
  }

  symbols.sort((a, b) => compare(a.id, b.id));
  for (const symbol of symbols) symbol.exportedAs.sort(compare);
  inventory.references.sort(
    (a, b) =>
      compare(a.location.file, b.location.file) || a.location.start - b.location.start || compare(a.kind, b.kind),
  );
  inventory.exports.sort((a, b) => compare(`${a.file}:${a.name}`, `${b.file}:${b.name}`));
  diagnostics.sort(
    (a, b) =>
      compare(a.location?.file ?? '', b.location?.file ?? '') ||
      (a.location?.start ?? 0) - (b.location?.start ?? 0) ||
      compare(a.code, b.code),
  );
  inventory.completeness = diagnostics.length ? 'partial' : 'complete';
  inventory.snapshotId = hash(JSON.stringify(inventory));
  return inventory;

  function location(node: ts.Node): Location {
    const source = node.getSourceFile();
    const start = node.getStart(source);
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    return {
      file: portablePath(root, source.fileName),
      start,
      end: node.getEnd(),
      line: line + 1,
      column: character + 1,
    };
  }

  function addCompilerDiagnostic(diagnostic: ts.Diagnostic): void {
    let at: Location | null = null;
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      at = {
        file: portablePath(root, diagnostic.file.fileName),
        start: diagnostic.start,
        end: diagnostic.start + (diagnostic.length ?? 0),
        line: line + 1,
        column: character + 1,
      };
    }
    diagnostics.push({
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').replaceAll(root, '.'),
      location: at,
    });
  }

  function kindOf(node: ts.Node): SymbolKind | null {
    if (ts.isFunctionDeclaration(node)) return node.body ? 'function' : null;
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return 'function';
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
      return node.body ? 'method' : null;
    if (ts.isConstructorDeclaration(node)) return node.body ? 'constructor' : null;
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return 'class';
    if (ts.isInterfaceDeclaration(node)) return 'interface';
    if (ts.isTypeAliasDeclaration(node)) return 'type';
    if (ts.isEnumDeclaration(node)) return 'enum';
    return null;
  }

  function nameNode(node: ts.Node): ts.Node | undefined {
    const named = node as ts.NamedDeclaration;
    if (named.name) return named.name;
    const parent = node.parent;
    if (
      parent &&
      (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))
    )
      return parent.name;
    return undefined;
  }

  function collectDeclarations(node: ts.Node, containerId: string | null): void {
    const kind = kindOf(node);
    if (kind) {
      const named = nameNode(node);
      const at = location(node);
      const name =
        kind === 'constructor'
          ? 'constructor'
          : (named?.getText() ?? (hasDefaultModifier(node) ? 'default' : `<anonymous@${at.line}:${at.column}>`));
      const symbol: CodeSymbol = {
        id: `${at.file}:${at.start}:${kind}`,
        name,
        kind,
        location: at,
        containerId,
        scope: scopeOf(at.file),
        exportedAs: [],
      };
      symbols.push(symbol);
      byNode.set(node, symbol);
      if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        diagnostics.push({
          code: 'accessor-dispatch',
          message: 'Accessor declarations are inventoried, but implicit getter/setter dispatch is not resolved.',
          location: at,
        });
      }
      if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isVariableDeclarationList(node.parent.parent) &&
        !(node.parent.parent.flags & ts.NodeFlags.Const)
      ) {
        diagnostics.push({
          code: 'mutable-binding',
          message: 'Function binding can be reassigned; references are not attributed to its initializer.',
          location: at,
        });
      }
      if (named) {
        const compilerSymbol = checker.getSymbolAtLocation(named);
        if (compilerSymbol) bySymbol.set(compilerSymbol, symbol);
      }
      // Named expressions have both an inner name and an outer variable binding.
      if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && ts.isVariableDeclaration(node.parent)) {
        const outer = checker.getSymbolAtLocation(node.parent.name);
        if (outer) bySymbol.set(outer, symbol);
      }
      containerId = symbol.id;
    }
    ts.forEachChild(node, (child) => collectDeclarations(child, containerId));
  }

  function hasDefaultModifier(node: ts.Node): boolean {
    return (
      ts.canHaveModifiers(node) &&
      !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    );
  }

  function canonical(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
    if (!symbol) return undefined;
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }

  function resolveSymbol(symbol: ts.Symbol | undefined, seen = new Set<ts.Symbol>()): CodeSymbol | undefined {
    const actual = canonical(symbol);
    if (!actual || seen.has(actual)) return undefined;
    if (actual.flags & ts.SymbolFlags.Accessor) return undefined;
    if (
      actual.declarations?.some(
        (declaration) =>
          ts.isVariableDeclaration(declaration) &&
          ts.isVariableDeclarationList(declaration.parent) &&
          !(declaration.parent.flags & ts.NodeFlags.Const),
      )
    )
      return undefined;
    const direct = bySymbol.get(actual);
    if (direct) return direct;
    seen.add(actual);
    for (const declaration of actual.declarations ?? []) {
      const stored = byNode.get(declaration);
      if (stored) return stored;
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & ts.NodeFlags.Const
      ) {
        const expression = unwrap(declaration.initializer);
        if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
          const target = resolveSymbol(checker.getSymbolAtLocation(expression), seen);
          if (target) return target;
        }
      }
    }
    return undefined;
  }

  function unwrap(node: ts.Expression): ts.Expression {
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      node = node.expression;
    return node;
  }

  function resolveExpression(node: ts.Expression): CodeSymbol | undefined {
    const expression = unwrap(node);
    const direct = byNode.get(expression);
    if (direct) return direct;
    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression))
      return resolveSymbol(checker.getSymbolAtLocation(expression));
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
      const property = checker.getTypeAtLocation(expression.expression).getProperty(expression.argumentExpression.text);
      return resolveSymbol(property);
    }
    return undefined;
  }

  function collectExports(source: ts.SourceFile): void {
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) return;
    const file = portablePath(root, source.fileName);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      let target = resolveSymbol(exported);
      if (!target) {
        for (const declaration of canonical(exported)?.declarations ?? []) {
          if (ts.isExportAssignment(declaration)) target = resolveExpression(declaration.expression);
        }
      }
      inventory.exports.push({ file, name: exported.name, targetId: target?.id ?? null });
      if (target) target.exportedAs.push(`${file}#${exported.name}`);
    }
  }

  function addReference(target: CodeSymbol, node: ts.Node, kind: ReferenceKind, callerId: string | null): void {
    const at = location(node);
    inventory.references.push({ targetId: target.id, kind, location: at, callerId, scope: scopeOf(at.file) });
  }

  function declarationName(node: ts.Node): boolean {
    const parent = node.parent;
    return (
      !!parent &&
      (parent as ts.NamedDeclaration).name === node &&
      !ts.isPropertyAccessExpression(parent) &&
      !ts.isShorthandPropertyAssignment(parent) &&
      !ts.isJsxAttribute(parent)
    );
  }

  function contextKind(node: ts.Node): ReferenceKind {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent) || ts.isImportEqualsDeclaration(parent)) return 'import';
      if (ts.isExportDeclaration(parent)) return 'reexport';
      if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) {
        if (node === parent.tagName || node.parent === parent.tagName) return 'jsx';
      }
      if (ts.isTypeNode(parent)) return 'type';
      if (ts.isExpressionStatement(parent) || ts.isStatement(parent)) break;
    }
    return 'read';
  }

  function addModule(
    node: ts.Node,
    specifier: ts.Expression | undefined,
    kind: 'import' | 'export' | 'dynamic-import' | 'require',
    typeOnly = false,
  ): void {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      diagnostics.push({
        code: 'dynamic-module',
        message: 'Module path is not a literal; its dependencies are unknown.',
        location: location(node),
      });
      return;
    }
    const resolved = ts.resolveModuleName(
      specifier.text,
      node.getSourceFile().fileName,
      options,
      ts.sys,
    ).resolvedModule;
    inventory.modules.push({
      specifier: specifier.text,
      kind,
      location: location(specifier),
      typeOnly,
      resolvedFile: resolved ? portablePath(root, resolved.resolvedFileName) : null,
    });
    if (!resolved)
      diagnostics.push({
        code: 'unresolved-module',
        message: `Module could not be resolved: ${specifier.text}`,
        location: location(specifier),
      });
  }

  function visit(node: ts.Node, callerId: string | null, callTargetNode?: ts.Node): void {
    const declaration = byNode.get(node);
    if (declaration) callerId = declaration.id;
    if (ts.isImportDeclaration(node))
      addModule(node, node.moduleSpecifier, 'import', node.importClause?.isTypeOnly ?? false);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      addModule(node, node.moduleSpecifier, 'export', node.isTypeOnly);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addModule(node, node.moduleReference.expression, 'require', node.isTypeOnly);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = unwrap(node.expression);
      if (expression.kind === ts.SyntaxKind.ImportKeyword) addModule(node, node.arguments?.[0], 'dynamic-import');
      else if (ts.isIdentifier(expression) && expression.text === 'require' && !resolveExpression(expression)) {
        addModule(node, node.arguments?.[0], 'require');
      } else {
        const target = resolveExpression(expression);
        if (target) {
          addReference(target, node.expression, ts.isNewExpression(node) ? 'construct' : 'call', callerId);
          if (ts.isNewExpression(node) && target.kind === 'class') {
            const constructor = symbols.find(
              (symbol) => symbol.kind === 'constructor' && symbol.containerId === target.id,
            );
            if (constructor) addReference(constructor, node.expression, 'construct', callerId);
          }
          callTargetNode = ts.isPropertyAccessExpression(expression)
            ? expression.name
            : ts.isElementAccessExpression(expression)
              ? expression.argumentExpression
              : expression;
        } else {
          const signature = checker.getResolvedSignature(node);
          const declaration = signature?.declaration;
          if (!declaration || sourceSet.has(declaration.getSourceFile().fileName)) {
            diagnostics.push({
              code: 'unresolved-call',
              message: 'Call target cannot be tied to a concrete project declaration.',
              location: location(node.expression),
            });
          }
        }
      }
    }
    const importOrExport = contextKind(node);
    const aliasSource =
      node.parent &&
      (ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent)) &&
      node.parent.propertyName === node;
    if (
      (ts.isIdentifier(node) || (ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent))) &&
      !aliasSource &&
      node !== callTargetNode &&
      (!declarationName(node) || importOrExport === 'import' || importOrExport === 'reexport')
    ) {
      let compilerSymbol = checker.getSymbolAtLocation(node);
      if (ts.isShorthandPropertyAssignment(node.parent))
        compilerSymbol = checker.getShorthandAssignmentValueSymbol(node.parent);
      const target =
        ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent)
          ? resolveExpression(node.parent)
          : resolveSymbol(compilerSymbol);
      if (target) addReference(target, node, importOrExport, callerId);
    }
    ts.forEachChild(node, (child) => visit(child, callerId, callTargetNode));
  }
}
