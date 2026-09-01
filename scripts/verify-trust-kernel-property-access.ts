/**
 * CI-enforced gate for BLOCKED-011's final delegate ruling
 * (`spec/first100/exec/BLOCKED-QUEUE.md`): reject any real (non-vendor,
 * non-test) source reading the bare `ctx.trustKernel` property -- dotted
 * access, bracket access, or destructuring -- off a value whose
 * `trustKernel` resolves to the Trust Kernel's declaration-merged property
 * on Cordis's `Context` (`packages/kernel/trust-kernel/src/index.ts`).
 * `pinTrustKernel` fully protects `ctx.get('trustKernel')`; bare property
 * access carries one documented residual (self-fiber-subtree poisoning,
 * `docs/architecture/trust-kernel-boundary.md#known-residual-self-subtree-property-access-poisoning`)
 * this gate keeps unreachable by construction, forcing every real consumer
 * through `ctx.get('trustKernel')` instead.
 */

import { existsSync, globSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** Real (non-vendor, non-test) TypeScript source globs this gate scans. */
const SOURCE_GLOBS = ['packages/*/*/src/**/*.ts', 'apps/*/src/**/*.ts']

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
 * object's type rather than a name node with its own symbol location.
 * @param objectExpression - the expression being indexed (`ctx` in `ctx['trustKernel']`).
 * @param checker - the program's type checker.
 * @returns whether the indexed object's `trustKernel` property is `Context.trustKernel`.
 */
function resolvesToContextTrustKernelViaElementAccess(objectExpression: ts.Expression, checker: ts.TypeChecker): boolean {
  const prop = checker.getTypeAtLocation(objectExpression).getProperty('trustKernel')
  return prop !== undefined && (prop.declarations ?? []).some(isContextTrustKernelDeclaration)
}

/**
 * Walk one source file's full AST for a bare `ctx.trustKernel` property
 * read: dotted access (`ctx.trustKernel`), bracket access
 * (`ctx['trustKernel']`), and destructuring (`const { trustKernel } = ctx`).
 * `ctx.get('trustKernel')` is unaffected -- the string literal there is a
 * call argument, never a property name the checker resolves against
 * `Context`.
 * @param rel - the file's repo-relative path (for violation pointers).
 * @param sf - the file's parsed source.
 * @param checker - the program's type checker.
 * @param violations - the aggregate list violations append to.
 */
function walk(rel: string, sf: ts.SourceFile, checker: ts.TypeChecker, violations: string[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'trustKernel'
      && resolvesToContextTrustKernel(node.name, checker)) {
      violations.push(`${pointer(rel, sf, node)}: reads 'ctx.trustKernel' by property access; use ctx.get('trustKernel') instead.`)
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === 'trustKernel' && resolvesToContextTrustKernelViaElementAccess(node.expression, checker)) {
      violations.push(`${pointer(rel, sf, node)}: reads 'trustKernel' by bracket property access; use ctx.get('trustKernel') instead.`)
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'trustKernel'
        && resolvesToContextTrustKernel(key, checker)) {
        violations.push(`${pointer(rel, sf, node)}: destructures 'trustKernel' by property access; use ctx.get('trustKernel') instead.`)
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
    walk(rel, sf, checker, violations)
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
