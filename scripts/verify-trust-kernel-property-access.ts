/**
 * CI-enforced gate for BLOCKED-011's final delegate ruling
 * (`spec/first100/exec/BLOCKED-QUEUE.md`): reject any real (non-vendor,
 * non-test) source reading the bare `ctx.trustKernel` property -- dotted
 * access, bracket access, destructuring, or a key that resolves to
 * `'trustKernel'` only through the type checker (a `const`-narrowed
 * variable, a template-literal-typed expression, or `Reflect.get`) -- off a
 * value whose `trustKernel` resolves to the Trust Kernel's
 * declaration-merged property on Cordis's `Context`
 * (`packages/kernel/trust-kernel/src/index.ts`). `pinTrustKernel` fully
 * protects `ctx.get('trustKernel')`; bare property access carries one
 * documented residual (property-access poisoning reachable across the
 * plugin tree, `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`)
 * this gate keeps unreachable by construction, forcing every real consumer
 * through `ctx.get('trustKernel')` instead.
 *
 * The AST walk alone only catches a key that is a string literal AT the
 * access site. An access whose key resolves to `'trustKernel'` only through
 * TypeScript's type system -- `const K = 'trustKernel' as const; ctx[K]`, a
 * template-literal key cast to the literal type, or `Reflect.get(ctx,
 * 'trustKernel')` -- typechecks cleanly and is just as real a read; this
 * gate asks the type checker for the key expression's type and flags it
 * whenever that type is (or is a union including) the string-literal type
 * `'trustKernel'`, not only when the key is a literal at the access site.
 */

import { existsSync, globSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** Real (non-vendor, non-test) TypeScript source globs this gate scans. */
const SOURCE_GLOBS = ['packages/*/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}']

/** Repo-relative source pointer `file:line` for a node's first character. */
function pointer(rel: string, sf: ts.SourceFile, node: ts.Node): string {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `${rel}:${line + 1}`
}

/**
 * True for the single declaration-merging property signature that adds
 * `trustKernel` to Cordis's `Context` (`declare module '@deepseek-ai/cordis'
 * { interface Context { trustKernel?: TrustKernel } }`,
 * `packages/kernel/trust-kernel/src/index.ts`) -- the legitimate declaration
 * site, never itself a read.
 * @param decl - a declaration of the resolved `trustKernel` symbol.
 * @returns whether `decl` is that declaration-merging property signature.
 */
function isContextTrustKernelDeclaration(decl: ts.Declaration): boolean {
  if (!ts.isPropertySignature(decl) || !ts.isIdentifier(decl.name) || decl.name.text !== 'trustKernel') return false
  const iface = decl.parent
  if (!ts.isInterfaceDeclaration(iface) || iface.name.text !== 'Context') return false
  const block = iface.parent
  return ts.isModuleBlock(block) && ts.isModuleDeclaration(block.parent)
    && ts.isStringLiteral(block.parent.name) && block.parent.name.text === '@deepseek-ai/cordis'
}

/**
 * Resolve whether a name node's symbol is the Trust Kernel's
 * declaration-merged `Context.trustKernel` property -- i.e. the read is
 * statically off a Cordis `Context`, not an unrelated `trustKernel` name the
 * checker resolves to some other declaration.
 * @param node - the name node to resolve (a property name or binding name).
 * @param checker - the program's type checker.
 * @returns whether `node`'s resolved symbol is `Context.trustKernel`.
 */
function resolvesToContextTrustKernel(node: ts.Node, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(node)
  return symbol !== undefined && (symbol.declarations ?? []).some(isContextTrustKernelDeclaration)
}

/**
 * Bracket-access variant of {@link resolvesToContextTrustKernel}: the
 * checker resolves an element-access expression's property through the
 * object's type rather than a name node with its own symbol location. Also
 * used for `Reflect.get`'s first argument, which indexes the same way.
 * @param objectExpression - the expression being indexed (`ctx` in `ctx['trustKernel']`).
 * @param checker - the program's type checker.
 * @returns whether the indexed object's `trustKernel` property is `Context.trustKernel`.
 */
function resolvesToContextTrustKernelViaElementAccess(objectExpression: ts.Expression, checker: ts.TypeChecker): boolean {
  const prop = checker.getTypeAtLocation(objectExpression).getProperty('trustKernel')
  return prop !== undefined && (prop.declarations ?? []).some(isContextTrustKernelDeclaration)
}

/**
 * Resolve a key expression's compile-time value as the string `'trustKernel'`
 * -- either a literal AST node directly (`ctx['trustKernel']`) or, for a key
 * that resolves to the same value only through the type system (`const K =
 * 'trustKernel' as const; ctx[K]`; a template-literal key cast to the
 * literal type; `Reflect.get`'s second argument), via the type checker's
 * inferred type for the expression: every string-literal constituent of
 * that type (a plain literal type, or a union) must be `'trustKernel'` --
 * not merely one member among others. This excludes a deliberately narrowed
 * key (the evasions above, where `'trustKernel'` is the only possible
 * string value) while not flagging a wide key-space cast like `prop as
 * keyof Context` (real code in this repo forwards arbitrary declared verbs
 * this way, e.g. `packages/extensions/cordis-client-runner/src/client/guard.ts`'s
 * dynamic ctx facade): `keyof Context` is a ~130-member union that happens
 * to include `'trustKernel'` incidentally, alongside every other Context
 * member, not a key this expression can only ever resolve to.
 * @param node - the key expression to resolve.
 * @param checker - the program's type checker.
 * @returns whether `node` resolves to the string `'trustKernel'` and nothing else.
 */
function resolvesToTrustKernelLiteral(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (ts.isStringLiteralLike(node)) return node.text === 'trustKernel'
  const type = checker.getTypeAtLocation(node)
  const parts = type.isUnion() ? type.types : [type]
  const stringLiterals = parts.filter(part => part.isStringLiteral())
  return stringLiterals.length > 0 && stringLiterals.every(part => part.value === 'trustKernel')
}

/**
 * True for the global `Reflect` identifier (the one declared ambiently by
 * one of TypeScript's own bundled lib files, e.g. `lib.es2015.reflect.d.ts`
 * -- `Program#isSourceFileDefaultLibrary` is true for every file in that
 * bundle, not only the primary `lib.d.ts` entry `SourceFile#hasNoDefaultLib`
 * alone would check), never a same-named local variable or import -- so
 * `Reflect.get(ctx, 'trustKernel')` is only flagged when it genuinely calls
 * the real `Reflect.get`.
 * @param node - the expression to check (`Reflect` in `Reflect.get(...)`).
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @param checker - the program's type checker.
 * @returns whether `node` resolves to the ambient global `Reflect`.
 */
function isGlobalReflectIdentifier(node: ts.Expression, program: ts.Program, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(node) || node.text !== 'Reflect') return false
  const symbol = checker.getSymbolAtLocation(node)
  const declarations = symbol?.declarations ?? []
  return declarations.length > 0 && declarations.every(decl => program.isSourceFileDefaultLibrary(decl.getSourceFile()))
}

/**
 * True for a call expression that is genuinely `Reflect.get(...)`, the
 * ambient global's own `get` method -- a call expression, not a
 * property/element access, so it needs its own check distinct from
 * {@link walk}'s property/element-access branches.
 * @param node - the call expression to check.
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @param checker - the program's type checker.
 * @returns whether `node` calls the global `Reflect.get`.
 */
function isReflectGetCall(node: ts.CallExpression, program: ts.Program, checker: ts.TypeChecker): boolean {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'get'
    && isGlobalReflectIdentifier(node.expression.expression, program, checker)
}

/**
 * Walk one source file's full AST for a bare `ctx.trustKernel` property
 * read: dotted access (`ctx.trustKernel`), bracket access
 * (`ctx['trustKernel']`) whether the key is a literal at the access site or
 * resolves to `'trustKernel'` only through the type checker (`const K =
 * 'trustKernel' as const; ctx[K]`, a template-literal key cast to the
 * literal type), destructuring (`const { trustKernel } = ctx`), and
 * `Reflect.get(ctx, 'trustKernel')` (a call expression, checked separately
 * since it is not a property/element access at all). `ctx.get('trustKernel')`
 * is unaffected -- the string literal there is a call argument, never a
 * property name the checker resolves against `Context`.
 * @param rel - the file's repo-relative path (for violation pointers).
 * @param sf - the file's parsed source.
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @param checker - the program's type checker.
 * @param violations - the aggregate list violations append to.
 */
function walk(rel: string, sf: ts.SourceFile, program: ts.Program, checker: ts.TypeChecker, violations: string[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'trustKernel'
      && resolvesToContextTrustKernel(node.name, checker)) {
      violations.push(`${pointer(rel, sf, node)}: reads 'ctx.trustKernel' by property access; use ctx.get('trustKernel') instead.`)
    } else if (ts.isElementAccessExpression(node) && resolvesToTrustKernelLiteral(node.argumentExpression, checker)
      && resolvesToContextTrustKernelViaElementAccess(node.expression, checker)) {
      const viaType = ts.isStringLiteralLike(node.argumentExpression) ? '' : ' (key resolves to \'trustKernel\' only through the type checker, not a literal at the access site)'
      violations.push(`${pointer(rel, sf, node)}: reads 'trustKernel' by bracket property access${viaType}; use ctx.get('trustKernel') instead.`)
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'trustKernel'
        && resolvesToContextTrustKernel(key, checker)) {
        violations.push(`${pointer(rel, sf, node)}: destructures 'trustKernel' by property access; use ctx.get('trustKernel') instead.`)
      }
    } else if (ts.isCallExpression(node) && isReflectGetCall(node, program, checker) && node.arguments.length >= 2) {
      const [target, key] = node.arguments
      if (target !== undefined && key !== undefined
        && resolvesToTrustKernelLiteral(key, checker) && resolvesToContextTrustKernelViaElementAccess(target, checker)) {
        violations.push(`${pointer(rel, sf, node)}: reads 'trustKernel' via Reflect.get(ctx, 'trustKernel'); use ctx.get('trustKernel') instead.`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** Compiler options for the walk's program, mirroring verify-export-jsdoc.ts. */
function loadCompilerOptions(scanRoot: string): ts.CompilerOptions {
  const cfgPath = resolve(scanRoot, 'tsconfig.base.json')
  if (!existsSync(cfgPath)) return { skipLibCheck: true, noLib: true, types: [] }
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile.bind(ts.sys)) as { config?: unknown }
  const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, scanRoot)
  return {
    ...parsed.options,
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
    // SOURCE_GLOBS includes .tsx (Evasion B, BLOCKED-QUEUE.md BLOCKED-011);
    // tsconfig.base.json itself never sets `jsx` (only tsconfig.base.client.json
    // does, per package), so this program needs its own setting to parse and
    // type-check client .tsx source without spurious JSX diagnostics.
    jsx: ts.JsxEmit.ReactJSX,
  }
}

/**
 * Walk every real (non-vendor, non-test) package and app source file and
 * collect bare `ctx.trustKernel` property-access violations. Returns
 * findings instead of throwing so tests assert on the list; the CLI entry
 * turns a non-empty list into exit 1.
 * @param scanRoot - the repo root to scan; tests pass a fixture dir.
 * @returns every violation, in file order, one human-readable line each.
 */
export function collectTrustKernelPropertyAccessViolations(scanRoot: string = root): string[] {
  const violations: string[] = []
  const rels = globSync(SOURCE_GLOBS, { cwd: scanRoot })
    .map(path => path.split(sep).join('/'))
    .sort()
  const program = ts.createProgram(rels.map(rel => resolve(scanRoot, rel)), loadCompilerOptions(scanRoot))
  const checker = program.getTypeChecker()
  for (const rel of rels) {
    const sf = program.getSourceFile(resolve(scanRoot, rel))
    if (!sf) continue // program root files always resolve; guard for narrowing
    walk(rel, sf, program, checker, violations)
  }
  return violations
}

/** CLI entry: list every violation and exit 1, or confirm the tree is clean. */
function main(): void {
  const violations = collectTrustKernelPropertyAccessViolations()
  if (violations.length === 0) {
    console.log('verify-trust-kernel-property-access: no real code reads the bare ctx.trustKernel property.')
    return
  }
  console.error(`verify-trust-kernel-property-access: ${violations.length} violation(s) (see docs/architecture/trust-kernel-boundary.md):`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
