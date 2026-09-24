/**
 * The Trust Kernel runtime module `src/index.ts`, read with the TypeScript
 * compiler: its string literals, its module specifiers and its exports.
 *
 * Shared by `runtime-surface.spec.ts` and the CLI case that reads a real
 * launch's model inputs (`apps/cli/tests/trust-kernel-model-input.spec.ts`),
 * so both judge the same literal list.
 * @module packages/kernel/trust-kernel/tests/fixtures/runtime-surface
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

/** The kernel package's `src/` directory. */
export const KERNEL_SRC_DIR = resolve(import.meta.dirname, '../../src')

/** The runtime module: the only kernel source file with runtime code. */
export const KERNEL_RUNTIME_MODULE = resolve(KERNEL_SRC_DIR, 'index.ts')

/** What a syntax walk of the runtime module found. */
export interface RuntimeModuleSyntax {
  /** Every string literal and substitution-free template literal that is not a module specifier or a `declare module` name, in source order. */
  readonly literals: readonly string[]
  /** Template literals with substitutions; their text is computed, so a literal list cannot account for it. */
  readonly templateExpressions: number
  /** Specifiers of import and export declarations and of dynamic `import()` calls, in source order. */
  readonly moduleSpecifiers: readonly string[]
  /** Names of the top-level function declarations. */
  readonly functionNames: readonly string[]
}

/**
 * Walk every node of the runtime module's syntax tree.
 * @returns the literals, template expressions, module specifiers and function names found.
 */
export function readRuntimeModuleSyntax(): RuntimeModuleSyntax {
  const source = ts.createSourceFile(
    KERNEL_RUNTIME_MODULE,
    readFileSync(KERNEL_RUNTIME_MODULE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const literals: string[] = []
  const moduleSpecifiers: string[] = []
  const excluded = new Set<ts.Node>()
  let templateExpressions = 0
  const specifier = (node: ts.Expression): void => {
    excluded.add(node)
    moduleSpecifiers.push(ts.isStringLiteralLike(node) ? node.text : node.getText(source))
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      specifier(node.moduleSpecifier)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument !== undefined) specifier(argument)
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      excluded.add(node.name)
    }
    if (!excluded.has(node)) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text)
      else if (ts.isTemplateExpression(node)) templateExpressions += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const functionNames = source.statements
    .filter(ts.isFunctionDeclaration)
    .flatMap(statement => statement.name === undefined ? [] : [statement.name.text])
  return { literals, templateExpressions, moduleSpecifiers, functionNames }
}

/** One name the runtime module exports, as the type checker resolves it. */
export interface RuntimeModuleExport {
  /** The exported name. */
  readonly name: string
  /** Whether the exported symbol (after alias resolution) carries a value meaning. */
  readonly isValue: boolean
}

const probeOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
}

/**
 * Ask the type checker for every export of the runtime module, `export type *` re-exports included.
 * @returns each exported name and whether it is a value.
 * @throws when the probe program cannot load the module or give it a module symbol.
 */
export function readRuntimeModuleExports(): readonly RuntimeModuleExport[] {
  const program = ts.createProgram([KERNEL_RUNTIME_MODULE], probeOptions)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(KERNEL_RUNTIME_MODULE)
  if (source === undefined) throw new Error('the probe program did not load src/index.ts')
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (moduleSymbol === undefined) throw new Error('src/index.ts has no module symbol')
  return checker.getExportsOfModule(moduleSymbol).map((exported) => {
    const target = (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported)
    return { name: exported.name, isValue: (target.flags & ts.SymbolFlags.Value) !== 0 }
  })
}
