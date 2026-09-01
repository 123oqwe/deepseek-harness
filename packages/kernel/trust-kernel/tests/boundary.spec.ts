/**
 * Contract-stage verification for Epic P0-02 (the minimal immutable Trust
 * Kernel boundary). `src/types.ts` has no runtime export at all -- it is a
 * types-only module per house convention -- so nothing here can construct a
 * `TrustKernel` value and inspect it live. Every check below is either a
 * structural read of the module's own AST (its exported shape, its
 * top-level statement kinds, its imports) or a real TypeScript compiler run
 * against a small virtual usage file that imports the real `src/types.ts`
 * and asserts on the compiler's own diagnostics -- a genuine, on-topic,
 * runtime-executed proof of a compile-time guarantee (readonly members,
 * unforgeable handles), matching what this Contract-stage slice can
 * honestly test. Full runtime enforcement over a constructed, frozen
 * `TrustKernel` value is a later slice's acceptance case (see
 * `spec/trust-kernel.md`).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../../..')
const typesPath = resolve(packageRoot, 'src/types.ts')
const typesSource = readFileSync(typesPath, 'utf8')

const sourceFile = ts.createSourceFile(typesPath, typesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/** Epic P0-02 must[2]'s six owned capabilities, as `TrustKernel` member names. */
const REQUIRED_TRUST_KERNEL_MEMBERS = [
  'rootIdentity',
  'signatureRoots',
  'policyEnforcement',
  'auditAppend',
  'secretBroker',
  'sandboxAttestationVerifier',
].toSorted()

/** The three unforgeable opaque capability handles. */
const OPAQUE_HANDLE_TYPES = [
  'TrustKernelRootIdentity',
  'TrustKernelSignatureRoots',
  'TrustKernelSecretBrokerHandle',
]

/** The three kernel-opaque payload carriers. */
const OPAQUE_PAYLOAD_TYPES = [
  'TrustKernelPolicyQuery',
  'TrustKernelAuditEntry',
  'TrustKernelSandboxAttestation',
]

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
}

function findExportedInterface(name: string): ts.InterfaceDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name && hasExportModifier(statement),
  )
}

/**
 * Type-check a small virtual usage file that imports the real `src/types.ts`
 * by absolute path, and return the compiler's own diagnostics for it.
 */
function compileVirtualUsage(snippet: string): readonly ts.Diagnostic[] {
  const virtualDir = mkdtempSync(join(tmpdir(), 'trust-kernel-boundary-'))
  const virtualPath = join(virtualDir, 'usage.ts')
  try {
    writeFileSync(virtualPath, snippet, 'utf8')
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      types: [],
    }
    const program = ts.createProgram([virtualPath], options)
    return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  } finally {
    rmSync(virtualDir, { recursive: true, force: true })
  }
}

function diagnosticMessages(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')
}

describe('TrustKernel type surface (Epic P0-02 must[2])', () => {
  it('imports nothing: the kernel type surface depends on no other package', () => {
    const imports = sourceFile.statements.filter(ts.isImportDeclaration)
    expect(imports, 'src/types.ts import declarations').toHaveLength(0)
  })

  it('has no runtime code: every top-level statement is a type/interface declaration or an ambient declare-const symbol', () => {
    for (const statement of sourceFile.statements) {
      const isTypeOnly = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
      const isAmbientConst =
        ts.isVariableStatement(statement)
        && (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
      const preview = statement.getText(sourceFile).split('\n')[0]?.slice(0, 80)
      expect(isTypeOnly || isAmbientConst, `unexpected runtime statement: ${preview}`).toBe(true)
    }
  })

  it('declares an exported TrustKernel interface with exactly the six must[2] members, all readonly, and no methods', () => {
    const trustKernel = findExportedInterface('TrustKernel')
    expect(trustKernel, 'exported TrustKernel interface').toBeDefined()
    expect(trustKernel!.members.every(ts.isPropertySignature), 'TrustKernel has only property signatures, no methods').toBe(true)
    const memberNames = trustKernel!.members
      .filter(ts.isPropertySignature)
      .map(member => (member.name as ts.Identifier).text)
      .toSorted()
    expect(memberNames).toEqual(REQUIRED_TRUST_KERNEL_MEMBERS)
    for (const member of trustKernel!.members.filter(ts.isPropertySignature)) {
      const isReadonly = member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
      expect(isReadonly, `TrustKernel.${(member.name as ts.Identifier).text} must be readonly`).toBe(true)
    }
  })

  it('exports no Config schema and no apply(ctx, config) plugin entry -- nothing here is a Cordis plugin export', () => {
    const hasConfigExport = sourceFile.statements.some(
      statement =>
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
        && statement.name.text === 'Config'
        && hasExportModifier(statement),
    )
    expect(hasConfigExport, 'exported Config type/interface').toBe(false)

    const hasApplyExport = sourceFile.statements.some((statement) => {
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) return statement.name?.text === 'apply'
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        return statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'apply')
      }
      return false
    })
    expect(hasApplyExport, 'exported apply plugin entry').toBe(false)
  })

  it.each(OPAQUE_HANDLE_TYPES)('brands %s as an opaque interface, never a plain type alias', (name) => {
    const decl = findExportedInterface(name)
    expect(decl, `exported ${name} interface`).toBeDefined()
    const isAliased = sourceFile.statements.some(
      statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
    )
    expect(isAliased, `${name} must not also be declared as a type alias`).toBe(false)
  })

  it.each(OPAQUE_PAYLOAD_TYPES)('keeps %s.payload exactly `unknown` -- no business-domain field on the kernel surface', (name) => {
    const decl = findExportedInterface(name)
    expect(decl, `exported ${name} interface`).toBeDefined()
    const payload = decl!.members.find(
      (member): member is ts.PropertySignature =>
        ts.isPropertySignature(member) && (member.name as ts.Identifier).text === 'payload',
    )
    expect(payload, `${name}.payload member`).toBeDefined()
    expect(payload!.type?.kind).toBe(ts.SyntaxKind.UnknownKeyword)
  })
})

describe('TrustKernel compile-time guarantees (Epic P0-02 acceptance: no replaceable/mutable shape)', () => {
  it('type-checks a well-formed TrustKernel usage with zero diagnostics', () => {
    const diagnostics = compileVirtualUsage(`
import type { TrustKernel, TrustKernelPolicyQuery } from ${JSON.stringify(typesPath)}

declare const kernel: TrustKernel

const query: TrustKernelPolicyQuery = { payload: 'anything' }
const verdict = kernel.policyEnforcement(query)
verdict satisfies 'allow' | 'deny'
kernel.auditAppend({ payload: { note: 'anything' } })
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('rejects reassigning a TrustKernel member -- every capability is readonly', () => {
    const diagnostics = compileVirtualUsage(`
import type { TrustKernel } from ${JSON.stringify(typesPath)}

declare const kernel: TrustKernel
kernel.rootIdentity = kernel.rootIdentity
`)
    const codes = diagnostics.map(d => d.code)
    expect(codes, diagnosticMessages(diagnostics)).toContain(2540)
  })

  it('rejects constructing an opaque handle from an object literal -- no legitimate value exists outside an unsafe cast', () => {
    const diagnostics = compileVirtualUsage(`
import type { TrustKernelRootIdentity } from ${JSON.stringify(typesPath)}

const forged: TrustKernelRootIdentity = {}
`)
    const codes = diagnostics.map(d => d.code)
    expect(codes.some(code => code === 2739 || code === 2741 || code === 2322), diagnosticMessages(diagnostics)).toBe(true)
  })
})

describe('docs/architecture/trust-kernel-boundary.md (Epic P0-02 must[4])', () => {
  const docText = readFileSync(resolve(repoRoot, 'docs/architecture/trust-kernel-boundary.md'), 'utf8')

  it.each(['models', 'tools', 'storage providers', 'workflow', 'memory provider', 'ui'])(
    'names %s among what remains a plugin',
    (term) => {
      expect(docText.toLowerCase()).toContain(term)
    },
  )

  it.each(['root identity', 'deny enforcement', 'audit-chain root', 'signature-verification root'])(
    'names %s among what is never a plugin',
    (term) => {
      expect(docText.toLowerCase()).toContain(term)
    },
  )

  it('cross-references the TrustKernel type surface and the ctx.provide/ctx.plugin distinction', () => {
    expect(docText).toContain('src/types.ts')
    expect(docText).toContain('ctx.provide')
    expect(docText).toContain('ctx.plugin')
  })
})

describe('spec/trust-kernel.md (Epic P0-02 release deliverable)', () => {
  const specText = readFileSync(resolve(repoRoot, 'spec/trust-kernel.md'), 'utf8')

  it.each(REQUIRED_TRUST_KERNEL_MEMBERS)('documents the %s capability', (member) => {
    expect(specText).toContain(member)
  })

  it('cross-references the boundary doc and this slice\'s own test file', () => {
    expect(specText).toContain('docs/architecture/trust-kernel-boundary.md')
    expect(specText).toContain('boundary.spec.ts')
  })
})
