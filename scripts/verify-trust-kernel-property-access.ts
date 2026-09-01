/**
 * CI-enforced gate for BLOCKED-011's final delegate ruling
 * (`spec/first100/exec/BLOCKED-QUEUE.md`): reject any real (non-vendor,
 * non-test) source reading the bare `ctx.trustKernel` property -- forcing
 * every real consumer through `ctx.get('trustKernel')` instead, which
 * `pinTrustKernel` fully protects. Property access carries one documented
 * residual (property-access poisoning reachable across the plugin tree,
 * `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`)
 * this gate keeps unreachable by construction.
 *
 * Two independent, additive detection layers run over the same AST walk:
 *
 * 1. **Symbol/type-precise layer** -- flags a read only once the type
 *    checker confirms BOTH that the accessed object's static type resolves
 *    to Cordis `Context`'s declaration-merged `trustKernel` property
 *    ({@link resolvesToContextTrustKernel} / {@link resolvesToContextTrustKernelViaElementAccess})
 *    AND that a non-literal key's type is exactly the string-literal type
 *    `'trustKernel'` ({@link resolvesToTrustKernelLiteral}, e.g. `const K =
 *    'trustKernel' as const; ctx[K]`). Precise, but round 3's adversarial
 *    review (BLOCKED-QUEUE.md) proved this alone cannot converge: any cast,
 *    structural-type alias, or key-computation the type checker cannot
 *    narrow to a literal walks through undetected -- `(ctx as
 *    any).trustKernel`, a structural-alias interface, a runtime-concatenated
 *    or ternary-selected key, and `Reflect.get` reached through an alias or
 *    destructured binding all typecheck cleanly while genuinely reading the
 *    live kernel.
 * 2. **Name-based layer** ({@link hasTrustKernelNamedProperty},
 *    {@link foldStringLiterals}) -- flags a read whenever the accessed or
 *    resolved NAME is syntactically the string `'trustKernel'`, independent
 *    of whether the type checker's precise resolution above succeeds. A
 *    dotted access or a non-computed destructuring key is unconditional
 *    (the name is always textually explicit at the access site, so cannot
 *    be spoofed the way a type can be cast away). A bracket-shaped access
 *    (element access, a computed destructuring key, or `Reflect.get`'s
 *    target) additionally requires the base expression -- unwrapped through
 *    any `as`/`satisfies`/angle-bracket/non-null wrapping via
 *    {@link unwrapCasts}, so a cast cannot hide the true underlying value --
 *    to structurally carry SOME property literally named `trustKernel`
 *    (not merely a generic string-index signature): this is strictly looser
 *    than layer 1's exact-declaration match (so it also catches a
 *    structural-alias interface reached through bracket syntax), but still
 *    excludes `packages/kernel/trust-kernel/src/index.ts`'s own legitimate
 *    `ctx.root[Context.isolate]['trustKernel']` -- indexing the isolation
 *    map, a plain `Dict<symbol>` with no named `trustKernel` member, an
 *    entirely different real access this gate must never flag. A bracket
 *    key's own value is resolved the same way, independent of its
 *    TypeScript type: {@link foldStringLiterals} constant-folds string
 *    literals, template literals, parenthesized/cast wrapping, `+`
 *    concatenation, a ternary's two branches, and a `const` identifier's
 *    initializer, so `ctx[('trust' + 'Kernel') as keyof Context]` and `const
 *    k = cond ? 'trustKernel' : 'root'; ctx[k]` are both caught even though
 *    neither key's TYPE narrows to the literal `'trustKernel'` (a
 *    concatenation widens to `string`; a ternary between two literals widens
 *    to their union, and here is additionally hidden behind an unrelated
 *    branch value).
 *
 * `Reflect.get(ctx, 'trustKernel')` needs its own callee identification
 * ({@link isReflectGetCall}): resolving the callee expression's TYPE symbol
 * (not matching identifier text) recognizes the ambient `Reflect.get`
 * function through any alias, destructuring, or bracket-call indirection --
 * `const R = Reflect; R.get(...)`, `const { get: reflectGet } = Reflect;
 * reflectGet(...)`, and `Reflect['get'](...)` all resolve to the same
 * default-lib declaration this way, none needing their own spelling-specific
 * case.
 *
 * `ctx.get('trustKernel')` is unaffected by every layer above -- the string
 * literal there is a call argument to an unrelated method, never a property
 * name or `Reflect.get` target the walk inspects.
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
 * site, never itself a read. Used only for the symbol-precise layer's
 * message nuance; the name-based layer's gating condition
 * ({@link hasTrustKernelNamedProperty}) does not require this exact match.
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
 * checker resolves to some other declaration. Message-nuance only; see
 * {@link isContextTrustKernelDeclaration}.
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
 * object's type rather than a name node with its own symbol location.
 * Message-nuance only.
 * @param objectNode - the expression (or binding pattern) being indexed.
 * @param checker - the program's type checker.
 * @returns whether the indexed object's `trustKernel` property is `Context.trustKernel`.
 */
function resolvesToContextTrustKernelViaElementAccess(objectNode: ts.Node, checker: ts.TypeChecker): boolean {
  const prop = checker.getTypeAtLocation(objectNode).getProperty('trustKernel')
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
 * key while not flagging a wide key-space cast like `prop as keyof Context`
 * (real code in this repo forwards arbitrary declared verbs this way, e.g.
 * `packages/extensions/cordis-client-runner/src/client/guard.ts`'s dynamic
 * ctx facade): `keyof Context` is a large union that happens to include
 * `'trustKernel'` incidentally, alongside every other Context member, not a
 * key this expression can only ever resolve to. This is the type-precise
 * layer's key check; {@link foldStringLiterals} is the name-based layer's
 * independent, syntactic counterpart, and either matching is sufficient.
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
 * Peel a key or base expression down through wrapping that changes what the
 * type checker reports without changing what runs -- parentheses, `as`/
 * `satisfies` type assertions, an angle-bracket type assertion, and a
 * non-null assertion -- to the innermost expression the checker can resolve
 * a genuine, un-cast type for. A cast can make the IMMEDIATE type look like
 * anything (`ctx as any`, `ctx as unknown as Record<string, TrustKernel |
 * undefined>`), but it cannot change what the value underneath actually is
 * at runtime; asking the checker about the peeled expression instead of the
 * cast recovers that real type.
 * @param node - the expression to unwrap.
 * @returns the innermost expression reachable by peeling cast/paren/non-null wrapping.
 */
function unwrapCasts(node: ts.Expression): ts.Expression {
  let current = node
  for (;;) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isNonNullExpression(current)) { current = current.expression; continue }
    return current
  }
}

/**
 * The name-based layer's base-shape gate for a bracket-shaped access
 * (element access, a computed destructuring key, or `Reflect.get`'s
 * target): true when the given node's type structurally carries SOME
 * property literally named `trustKernel` -- via `Type#getProperty`, which
 * resolves an own or inherited named member but NOT a generic string-index
 * signature. Strictly looser than {@link resolvesToContextTrustKernelViaElementAccess}
 * (no requirement that the property be exactly `Context.trustKernel`'s own
 * declaration, so a structural-alias interface reached through bracket
 * syntax still matches), yet still excludes
 * `packages/kernel/trust-kernel/src/index.ts`'s own legitimate
 * `ctx.root[Context.isolate]['trustKernel']`: `Context.isolate`'s value is a
 * plain `Dict<symbol>` (`{ [key: string]: symbol }`), whose ONLY route to
 * any key is the string-index signature -- `getProperty('trustKernel')`
 * returns `undefined` for it, verified directly against that type shape,
 * because a pure index signature never synthesizes a named property symbol.
 * The caller is expected to have already unwrapped the node through
 * {@link unwrapCasts} (or, for a destructuring key, an equivalent source
 * resolution) so a cast cannot hide a genuinely Context-shaped origin.
 * @param node - the (already cast-unwrapped) base node to check.
 * @param checker - the program's type checker.
 * @returns whether the node's type has an own or inherited `trustKernel` member.
 */
function hasTrustKernelNamedProperty(node: ts.Node, checker: ts.TypeChecker): boolean {
  return checker.getTypeAtLocation(node).getProperty('trustKernel') !== undefined
}

/**
 * Constant-folds a syntactic string expression to the closed set of literal
 * string values it can evaluate to, independent of the TypeScript type
 * checker's type narrowing -- so a value the checker widens to plain
 * `string` (a runtime `+`-concatenation, a ternary between two literals) is
 * still resolved by walking the literal AST rather than asking the checker
 * for a type. This is the name-based layer's key check, additive to
 * {@link resolvesToTrustKernelLiteral}'s type-precise one (either matching
 * is sufficient): a generic-typed identifier narrowed to the literal type
 * `'trustKernel'` only through the type system (e.g. a generic type
 * parameter's constraint) is NOT foldable here but IS caught by the
 * type-precise check, while a ternary-selected or concatenated key IS
 * foldable here but is NOT narrowed to a literal type by the checker.
 * Handles: a string literal or no-substitution template literal (its own
 * text); parenthesized/cast/non-null wrapping (its inner expression,
 * ignoring the annotation, via {@link unwrapCasts}); a `+` binary expression
 * whose both operands fold (their concatenation); a conditional (ternary)
 * expression (the union of both branches, since either could run); and an
 * identifier bound by a single `const` declaration with an initializer
 * (that initializer, resolved recursively). Returns `undefined` when the
 * expression cannot be resolved to a closed set this way (a function call,
 * a `let`/`var` or destructured binding, an unresolvable identifier, or any
 * other runtime-computed value) -- there is then nothing for the name-based
 * layer to flag for that node, since it genuinely cannot determine the
 * accessed name syntactically.
 * @param node - the key expression to fold.
 * @param checker - the program's type checker (identifier resolution only).
 * @param seen - declarations already visited, guarding a cyclic `const` chain.
 * @returns the closed set of possible literal string values, or `undefined`.
 */
function foldStringLiterals(node: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Declaration> = new Set()): Set<string> | undefined {
  if (ts.isStringLiteralLike(node)) return new Set([node.text])
  const unwrapped = unwrapCasts(node)
  if (unwrapped !== node) return foldStringLiterals(unwrapped, checker, seen)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldStringLiterals(node.left, checker, seen)
    const right = foldStringLiterals(node.right, checker, seen)
    if (left === undefined || right === undefined) return undefined
    const out = new Set<string>()
    for (const l of left) for (const r of right) out.add(l + r)
    return out
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = foldStringLiterals(node.whenTrue, checker, seen)
    const whenFalse = foldStringLiterals(node.whenFalse, checker, seen)
    if (whenTrue === undefined || whenFalse === undefined) return undefined
    return new Set([...whenTrue, ...whenFalse])
  }
  if (ts.isIdentifier(node)) {
    const decl = checker.getSymbolAtLocation(node)?.valueDeclaration
    if (decl === undefined || seen.has(decl) || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined
    const declList = decl.parent
    if (!ts.isVariableDeclarationList(declList) || (declList.flags & ts.NodeFlags.Const) === 0) return undefined
    seen.add(decl)
    return foldStringLiterals(decl.initializer, checker, seen)
  }
  return undefined
}

/**
 * True whether a key expression names `'trustKernel'` under either
 * detection layer: the type-precise {@link resolvesToTrustKernelLiteral} or
 * the syntactic {@link foldStringLiterals}.
 * @param node - the key expression to check.
 * @param checker - the program's type checker.
 * @returns whether either layer resolves `node` to exactly `'trustKernel'`.
 */
function keyNamesTrustKernel(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (resolvesToTrustKernelLiteral(node, checker)) return true
  return foldStringLiterals(node, checker)?.has('trustKernel') ?? false
}

/**
 * For a destructuring pattern, the node whose (cast-unwrapped) type the
 * name-based layer's base-shape gate should inspect: the initializer of an
 * enclosing `const x = ...` / `let x = ...` variable declaration, unwrapped
 * through {@link unwrapCasts} so a cast on the destructured source cannot
 * hide a genuinely Context-shaped origin (mirroring element access); or,
 * absent an initializer (parameter destructuring), the pattern itself, whose
 * own declared/contextual type is already the real one since there is no
 * cast to peel.
 * @param pattern - the object binding pattern being destructured.
 * @returns the node to run {@link hasTrustKernelNamedProperty} against.
 */
function bindingPatternSourceCore(pattern: ts.ObjectBindingPattern): ts.Node {
  const parent = pattern.parent
  if (ts.isVariableDeclaration(parent) && parent.initializer !== undefined) return unwrapCasts(parent.initializer)
  return pattern
}

/**
 * True for the declaration of the ambient global `Reflect.get` --
 * `function get(...): any` inside TypeScript's bundled
 * `declare namespace Reflect { ... }` (`lib.es2015.reflect.d.ts`) --
 * distinguishing it from any other type's own unrelated `get` method (e.g.
 * `Map.prototype.get`, `WeakMap.prototype.get`), which resolves to a
 * `MethodSignature` inside that type's own interface, never a
 * `FunctionDeclaration` inside the `Reflect` namespace.
 * @param decl - a declaration to check.
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @returns whether `decl` is the ambient `Reflect.get` function declaration.
 */
function isReflectGetDeclaration(decl: ts.Declaration, program: ts.Program): boolean {
  if (!ts.isFunctionDeclaration(decl) || decl.name?.text !== 'get') return false
  if (!program.isSourceFileDefaultLibrary(decl.getSourceFile())) return false
  const block = decl.parent
  return ts.isModuleBlock(block) && ts.isModuleDeclaration(block.parent)
    && ts.isIdentifier(block.parent.name) && block.parent.name.text === 'Reflect'
}

/**
 * True for a call expression whose callee resolves -- through any alias,
 * destructuring, or bracket-call indirection -- to the ambient
 * `Reflect.get` (see {@link isReflectGetDeclaration}). Resolves the
 * callee's TYPE symbol (`checker.getTypeAtLocation(callee).getSymbol()`)
 * rather than matching identifier text or requiring the callee to be a
 * literal `Reflect.get` property access: verified to correctly resolve
 * `Reflect.get(...)`, `const R = Reflect; R.get(...)`, `const { get:
 * reflectGet } = Reflect; reflectGet(...)`, and `Reflect['get'](...)`
 * uniformly to the same default-lib declaration, and to correctly NOT
 * resolve an unrelated `.get(...)` call (`Map`/`WeakMap`/`Set`, all
 * declared in a different lib file and a different container interface) to
 * it.
 * @param node - the call expression to check.
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @param checker - the program's type checker.
 * @returns whether `node` calls the global `Reflect.get`.
 */
function isReflectGetCall(node: ts.CallExpression, program: ts.Program, checker: ts.TypeChecker): boolean {
  const symbol = checker.getTypeAtLocation(node.expression).getSymbol()
  return symbol !== undefined && (symbol.declarations ?? []).some(decl => isReflectGetDeclaration(decl, program))
}

/**
 * Walk one source file's full AST for a bare `ctx.trustKernel` property
 * read, applying both detection layers described in this module's own doc
 * comment: dotted access (`ctx.trustKernel`, including through a cast or a
 * structural-alias variable), bracket access (`ctx['trustKernel']`,
 * including through a cast on the base and/or a non-literal, syntactically
 * or type-foldable key), destructuring (`const { trustKernel } = ctx`,
 * including a computed property name), and `Reflect.get(ctx, 'trustKernel')`
 * reached through any alias or destructuring. `ctx.get('trustKernel')` is
 * unaffected -- the string literal there is a call argument, never a
 * property name the checker or the folder resolves against `Context`.
 * @param rel - the file's repo-relative path (for violation pointers).
 * @param sf - the file's parsed source.
 * @param program - the program (for `isSourceFileDefaultLibrary`).
 * @param checker - the program's type checker.
 * @param violations - the aggregate list violations append to.
 */
function walk(rel: string, sf: ts.SourceFile, program: ts.Program, checker: ts.TypeChecker, violations: string[]): void {
  const nameOnlyNote = ' (flagged by the name-based restricted-property rule: the base expression\'s static type does not resolve exactly to Cordis Context\'s own trustKernel declaration, but structurally carries a member literally named trustKernel)'

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'trustKernel') {
      const exact = resolvesToContextTrustKernel(node.name, checker)
      if (exact || hasTrustKernelNamedProperty(unwrapCasts(node.expression), checker)) {
        violations.push(`${pointer(rel, sf, node)}: reads 'ctx.trustKernel' by property access${exact ? '' : nameOnlyNote}; use ctx.get('trustKernel') instead.`)
      }
    } else if (ts.isElementAccessExpression(node)) {
      if (keyNamesTrustKernel(node.argumentExpression, checker)) {
        const exact = resolvesToContextTrustKernelViaElementAccess(node.expression, checker)
        if (exact || hasTrustKernelNamedProperty(unwrapCasts(node.expression), checker)) {
          const viaType = ts.isStringLiteralLike(node.argumentExpression) ? '' : ' (key resolves to \'trustKernel\' only through type-checker narrowing or syntactic constant-folding, not a literal at the access site)'
          violations.push(`${pointer(rel, sf, node)}: reads 'trustKernel' by bracket property access${viaType}${exact ? '' : nameOnlyNote}; use ctx.get('trustKernel') instead.`)
        }
      }
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      if (ts.isComputedPropertyName(key)) {
        if (keyNamesTrustKernel(key.expression, checker)) {
          const exact = resolvesToContextTrustKernelViaElementAccess(node.parent, checker)
          if (exact || hasTrustKernelNamedProperty(bindingPatternSourceCore(node.parent), checker)) {
            violations.push(`${pointer(rel, sf, node)}: destructures 'trustKernel' via a computed property name${exact ? '' : nameOnlyNote}; use ctx.get('trustKernel') instead.`)
          }
        }
      } else if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'trustKernel') {
        const exact = resolvesToContextTrustKernel(key, checker)
        if (exact || hasTrustKernelNamedProperty(bindingPatternSourceCore(node.parent), checker)) {
          violations.push(`${pointer(rel, sf, node)}: destructures 'trustKernel' by property access${exact ? '' : nameOnlyNote}; use ctx.get('trustKernel') instead.`)
        }
      }
    } else if (ts.isCallExpression(node) && isReflectGetCall(node, program, checker) && node.arguments.length >= 2) {
      const [target, key] = node.arguments
      if (target !== undefined && key !== undefined && keyNamesTrustKernel(key, checker)) {
        const exact = resolvesToContextTrustKernelViaElementAccess(target, checker)
        if (exact || hasTrustKernelNamedProperty(unwrapCasts(target), checker)) {
          violations.push(`${pointer(rel, sf, node)}: reads 'trustKernel' via Reflect.get(ctx, 'trustKernel')${exact ? '' : nameOnlyNote}; use ctx.get('trustKernel') instead.`)
        }
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
