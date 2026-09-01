/**
 * Contract-stage verification for Epic P0-07 (Release Evidence Package):
 * `@deepseek-ai/dsh-evidence-format`'s `src/types.ts` has no runtime export
 * at all -- it is a types-only module per house convention -- so nothing
 * here can construct an `EvidencePackage` value and inspect it live. Every
 * check below is either a structural read of the module's own AST (its
 * exported shape, its top-level statement kinds, its imports) or a real
 * TypeScript compiler run against a small virtual usage file that imports
 * the real `src/types.ts` and asserts on the compiler's own diagnostics --
 * a genuine, on-topic, runtime-executed proof of a compile-time guarantee,
 * matching what this Contract-stage slice can honestly test.
 *
 * The P-stage section below (`scripts/release/collect-evidence.mjs`/
 * `verify-evidence.mjs`) constructs and checks real `EvidencePackage`
 * values against real subprocess-driven gate runs and a real git fixture --
 * runtime proof for must[0]/must[1]/must[2] and acceptance[0]/[1], where
 * the Contract-stage checks above prove only the compile-time shape.
 *
 * `spec/first100-evidence.schema.json` is NOT exercised here. It is
 * pre-existing infrastructure of this same first100 program's own 109-item
 * self-tracking (`scripts/first100/generate-specs.ts`'s output, consumed
 * only by `scripts/first100/{common,report}.ts` and
 * `tests/first100/first100.spec.ts`): its `id` pattern is
 * `^P[0-8]-\d{2}$`, its `lane` enum is
 * `contract|provider|composition|fault`, and its `baselineSha` is a `const`
 * pinned to one fixed commit -- none of which describes a general release's
 * per-gate evidence or aggregate package. The registry's Epic P0-07
 * Contract-stage `files[]` names it alongside this spec and `src/types.ts`
 * only because both epics happen to use the word "evidence"; see this
 * epic's Writer report for the full analysis.
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ts from 'typescript'

const packageRoot = resolve(import.meta.dirname, '../../packages/assurance/evidence-format')
const typesPath = resolve(packageRoot, 'src/types.ts')
const indexPath = resolve(packageRoot, 'src/index.ts')
const brandSrcPath = resolve(import.meta.dirname, '../../packages/util/brand/src')

const typesSource = readFileSync(typesPath, 'utf8')
const indexSource = readFileSync(indexPath, 'utf8')

const typesSourceFileAst = ts.createSourceFile(typesPath, typesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const indexSourceFileAst = ts.createSourceFile(indexPath, indexSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/** must[0]'s per-gate base fields, carried by every `GateEvidence` outcome. */
const GATE_EVIDENCE_BASE_MEMBERS = ['gateId', 'command', 'startedAt', 'endedAt', 'environment', 'recordDigest'].toSorted()

/** The three real outcomes a gate run can have, and each variant's own (non-base) members. */
const GATE_EVIDENCE_VARIANTS: readonly (readonly [name: string, ownMembers: readonly string[]])[] = [
  ['CompletedGateEvidence', ['outcome', 'exitCode', 'logDigest', 'artifacts', 'testCounts', 'skipReasons'].toSorted()],
  ['SkippedGateEvidence', ['outcome', 'exitCode', 'logDigest', 'artifacts', 'testCounts', 'skipReasons'].toSorted()],
  ['MissingGateEvidence', ['outcome', 'exitCode', 'logDigest', 'artifacts', 'testCounts', 'skipReasons'].toSorted()],
]

/** must[1]'s branded nominal identifiers -- deliberately plain `Branded<B>` strings, never `unique symbol` handles (see this module's own doc comment for why). */
const BRANDED_TYPE_ALIASES: readonly (readonly [name: string, brand: string])[] = [
  ['Digest', 'EvidenceDigest'],
  ['Signature', 'EvidenceSignature'],
  ['CommitSha', 'CommitSha'],
  ['GateId', 'GateId'],
]

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
}

function findInterface(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  )
}

function findTypeAlias(sourceFile: ts.SourceFile, name: string): ts.TypeAliasDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  )
}

function memberNames(iface: ts.InterfaceDeclaration): string[] {
  return iface.members.filter(ts.isPropertySignature).map(member => (member.name as ts.Identifier).text).toSorted()
}

function assertAllMembersReadonly(iface: ts.InterfaceDeclaration, label: string): void {
  for (const member of iface.members.filter(ts.isPropertySignature)) {
    const isReadonly = member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
    expect(isReadonly, `${label}.${(member.name as ts.Identifier).text} must be readonly`).toBe(true)
  }
}

const compilerProbeOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
  // The real path mapping this module's own real import of
  // `@deepseek-ai/dsh-brand` needs to resolve -- mirrors
  // `tsconfig.base.json`'s own `paths` entry for the same package, scoped to
  // this probe rather than loading the whole workspace project graph. An
  // absolute path value needs no `baseUrl`.
  paths: {
    '@deepseek-ai/dsh-brand': [brandSrcPath],
  },
}

/** Type-check a small virtual usage file that imports the real `src/types.ts` by absolute path, and return the compiler's own diagnostics for it. */
function compileVirtualUsage(snippet: string): readonly ts.Diagnostic[] {
  const virtualDir = mkdtempSync(join(tmpdir(), 'evidence-format-contract-'))
  const virtualPath = join(virtualDir, 'usage.ts')
  try {
    writeFileSync(virtualPath, snippet, 'utf8')
    const program = ts.createProgram([virtualPath], compilerProbeOptions)
    return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  } finally {
    rmSync(virtualDir, { recursive: true, force: true })
  }
}

function diagnosticMessages(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')
}

function diagnosticCodes(diagnostics: readonly ts.Diagnostic[]): number[] {
  return diagnostics.map(d => d.code)
}

/** Fixture values a virtual usage snippet imports and builds on; every scenario below composes this preamble. */
const FIXTURE_PREAMBLE = `
import type {
  AcceptedEvidencePackage,
  CompletedGateEvidence,
  Digest,
  EvidencePackage,
  GateEnvironment,
  GateId,
  MissingGateEvidence,
  SkippedGateEvidence,
  UnacceptedEvidencePackage,
} from ${JSON.stringify(typesPath)}

declare const digest: Digest
declare const gateId: GateId
declare const env: GateEnvironment

const completed: CompletedGateEvidence = {
  gateId,
  command: 'pnpm run typecheck',
  startedAt: '2026-09-01T00:00:00.000Z',
  endedAt: '2026-09-01T00:00:01.000Z',
  environment: env,
  recordDigest: digest,
  outcome: 'completed',
  exitCode: 0,
  logDigest: digest,
  artifacts: [],
  testCounts: null,
  skipReasons: [],
}

const skipped: SkippedGateEvidence = {
  gateId,
  command: 'pnpm run test:e2e',
  startedAt: '2026-09-01T00:00:00.000Z',
  endedAt: '2026-09-01T00:00:01.000Z',
  environment: env,
  recordDigest: digest,
  outcome: 'skipped',
  exitCode: null,
  logDigest: null,
  artifacts: [],
  testCounts: null,
  skipReasons: ['no DEEPSEEK_API_KEY'],
}

const missing: MissingGateEvidence = {
  gateId,
  command: 'pnpm run lint',
  startedAt: '2026-09-01T00:00:00.000Z',
  endedAt: '2026-09-01T00:00:01.000Z',
  environment: env,
  recordDigest: digest,
  outcome: 'missing',
  exitCode: null,
  logDigest: null,
  artifacts: [],
  testCounts: null,
  skipReasons: ['collector crashed before this gate started'],
}
`

describe('GateEvidence type surface (Epic P0-07 must[0])', () => {
  it('imports only a type-only Branded from @deepseek-ai/dsh-brand -- no other import, no runtime dependency edge', () => {
    const imports = typesSourceFileAst.statements.filter(ts.isImportDeclaration)
    expect(imports, 'src/types.ts import declarations').toHaveLength(1)
    const [importDecl] = imports
    expect(importDecl!.importClause?.phaseModifier, 'the one import must be `import type`').toBe(ts.SyntaxKind.TypeKeyword)
    expect((importDecl!.moduleSpecifier as ts.StringLiteral).text).toBe('@deepseek-ai/dsh-brand')
  })

  it('exports no Config schema and no apply(ctx, config) plugin entry -- nothing here is a Cordis plugin export', () => {
    const hasConfigExport = typesSourceFileAst.statements.some(
      statement =>
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
        && statement.name.text === 'Config'
        && hasExportModifier(statement),
    )
    expect(hasConfigExport, 'exported Config type/interface').toBe(false)

    const hasApplyExport = typesSourceFileAst.statements.some((statement) => {
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) return statement.name?.text === 'apply'
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        return statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'apply')
      }
      return false
    })
    expect(hasApplyExport, 'exported apply plugin entry').toBe(false)
  })

  it('declares GateEvidence as a discriminated union of CompletedGateEvidence | SkippedGateEvidence | MissingGateEvidence', () => {
    const alias = findTypeAlias(typesSourceFileAst, 'GateEvidence')
    expect(alias, 'exported GateEvidence type alias').toBeDefined()
    expect(hasExportModifier(alias!)).toBe(true)
    const text = alias!.type.getText(typesSourceFileAst)
    for (const [variant] of GATE_EVIDENCE_VARIANTS) expect(text).toContain(variant)
  })

  it('gives GateEvidenceBase (unexported) exactly the must[0] base fields, all readonly', () => {
    const base = findInterface(typesSourceFileAst, 'GateEvidenceBase')
    expect(base, 'GateEvidenceBase interface').toBeDefined()
    expect(hasExportModifier(base!), 'GateEvidenceBase must not be exported -- it is an internal building block').toBe(false)
    expect(memberNames(base!)).toEqual(GATE_EVIDENCE_BASE_MEMBERS)
    assertAllMembersReadonly(base!, 'GateEvidenceBase')
  })

  it.each(GATE_EVIDENCE_VARIANTS)('exports %s with exactly its own declared members, all readonly, extending GateEvidenceBase', (name, ownMembers) => {
    const iface = findInterface(typesSourceFileAst, name)
    expect(iface, `exported ${name} interface`).toBeDefined()
    expect(hasExportModifier(iface!)).toBe(true)
    const heritageText = iface!.heritageClauses?.map(h => h.getText(typesSourceFileAst)).join(' ') ?? ''
    expect(heritageText, `${name} must extend GateEvidenceBase`).toContain('GateEvidenceBase')
    expect(memberNames(iface!)).toEqual(ownMembers)
    assertAllMembersReadonly(iface!, name)
  })

  it.each(BRANDED_TYPE_ALIASES)('types %s as Branded<%s"> -- a plain nominal string, never a unique-symbol handle', (name, brand) => {
    const alias = findTypeAlias(typesSourceFileAst, name)
    expect(alias, `exported ${name} type alias`).toBeDefined()
    expect(hasExportModifier(alias!)).toBe(true)
    expect(alias!.type.getText(typesSourceFileAst)).toBe(`Branded<'${brand}'>`)
  })
})

describe('compile-time guarantees over GateEvidence (Epic P0-07 must[0], real tsc diagnostics)', () => {
  it('type-checks well-formed CompletedGateEvidence, SkippedGateEvidence, and MissingGateEvidence literals with zero diagnostics', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
completed satisfies CompletedGateEvidence
skipped satisfies SkippedGateEvidence
missing satisfies MissingGateEvidence
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('rejects a CompletedGateEvidence literal whose skipReasons is nonempty -- a completed gate carries no skip reason', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
const bad: CompletedGateEvidence = { ...completed, skipReasons: ['should not be allowed'] }
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })

  it('rejects a SkippedGateEvidence literal whose skipReasons is empty -- a skip must name at least one real reason', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
const bad: SkippedGateEvidence = { ...skipped, skipReasons: [] }
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })

  it('rejects a MissingGateEvidence literal whose skipReasons is empty -- a missing gate must also name at least one real reason', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
const bad: MissingGateEvidence = { ...missing, skipReasons: [] }
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })

  it('rejects reassigning a GateEvidence member -- every field is readonly (TS2540)', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
completed.exitCode = 1
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2540)
  })

  it('rejects a plain string literal where a Digest is required -- Digest is a Branded nominal type, not a bare string', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
const forged: Digest = 'not-really-a-digest'
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })
})

describe('EvidencePackage aggregate binding (Epic P0-07 must[1])', () => {
  it('binds baselineFingerprint, gitDiff, additionalGates, and signature on EVERY EvidencePackage, before any accepted-narrowing', () => {
    // Accessing these four members through the bare `EvidencePackage` union
    // type, with no `if (pkg.accepted)` narrowing first, only type-checks if
    // every union member (accepted and unaccepted alike) actually carries
    // them -- a real proof they sit on the shared base, not duplicated
    // per-variant and possibly drifting.
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
declare const pkg: EvidencePackage
pkg.baselineFingerprint.gitSha satisfies string
pkg.gitDiff.baseSha satisfies string
pkg.additionalGates satisfies readonly unknown[]
pkg.signature satisfies string
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('types BaselineFingerprintBinding.gitSha, GitDiffBinding.baseSha, and GitDiffBinding.headSha as the CommitSha brand -- distinct from GateId, not a bare string that would satisfy any brand', () => {
    // A bare `string` widening target (`const x: string = pkg....gitSha`)
    // would type-check regardless of branding, proving nothing. Assigning
    // into a DIFFERENT branded type (`GateId`) only fails to compile if the
    // source field is genuinely nominally typed as `CommitSha`, not a plain
    // string that happens to satisfy every brand.
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
declare const pkg: EvidencePackage
const notAGateId1: GateId = pkg.baselineFingerprint.gitSha
const notAGateId2: GateId = pkg.gitDiff.baseSha
const notAGateId3: GateId = pkg.gitDiff.headSha
`)
    expect(diagnosticCodes(diagnostics).filter(code => code === 2322).length, diagnosticMessages(diagnostics)).toBe(3)
  })
})

describe('accepted cannot type-check as true with a missing or skipped required gate (Epic P0-07 must[2], real tsc diagnostics)', () => {
  const REQUIRED_UNION_PREAMBLE = `${FIXTURE_PREAMBLE}
type RequiredGateId = 'typecheck' | 'lint' | 'test'
type RequiredArtifactPath = 'lib/index.js'
`
  const PACKAGE_BASE_FIELDS = `
  formatVersion: 1,
  baselineFingerprint: { gitSha: 'sha' as any, digest },
  gitDiff: { baseSha: 'sha' as any, headSha: 'sha' as any, digest },
  additionalGates: [],
  signature: 'sig' as any,
`

  it('type-checks an AcceptedEvidencePackage literal when every required gate id is present and CompletedGateEvidence, and every required artifact path is present', () => {
    const diagnostics = compileVirtualUsage(`${REQUIRED_UNION_PREAMBLE}
const pkg: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: { typecheck: completed, lint: completed, test: completed },
  requiredBuildArtifacts: { 'lib/index.js': digest },
}
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('rejects an AcceptedEvidencePackage literal that omits one required gate id from requiredGates', () => {
    const diagnostics = compileVirtualUsage(`${REQUIRED_UNION_PREAMBLE}
const pkg: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: { typecheck: completed, lint: completed },
  requiredBuildArtifacts: { 'lib/index.js': digest },
}
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2741)
  })

  it('rejects an AcceptedEvidencePackage literal whose requiredGates assigns a SkippedGateEvidence to a required gate id', () => {
    const diagnostics = compileVirtualUsage(`${REQUIRED_UNION_PREAMBLE}
const pkg: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: { typecheck: completed, lint: skipped, test: completed },
  requiredBuildArtifacts: { 'lib/index.js': digest },
}
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })

  it('rejects an AcceptedEvidencePackage literal whose requiredGates assigns a MissingGateEvidence to a required gate id', () => {
    const diagnostics = compileVirtualUsage(`${REQUIRED_UNION_PREAMBLE}
const pkg: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: { typecheck: completed, lint: missing, test: completed },
  requiredBuildArtifacts: { 'lib/index.js': digest },
}
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2322)
  })

  it('rejects an AcceptedEvidencePackage literal that omits one required build artifact path from requiredBuildArtifacts -- must[2]\'s "missing artifact" clause', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
type RequiredGateId = 'typecheck' | 'lint' | 'test'
type RequiredArtifactPath = 'lib/index.js' | 'lib/invariant.js'
const pkg: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: { typecheck: completed, lint: completed, test: completed },
  requiredBuildArtifacts: { 'lib/index.js': digest },
}
`)
    expect(diagnosticCodes(diagnostics), diagnosticMessages(diagnostics)).toContain(2741)
  })

  it('type-checks an UnacceptedEvidencePackage literal whose requiredGates has a SkippedGateEvidence and whose requiredBuildArtifacts is empty -- accepted:false imposes no completeness or outcome constraint', () => {
    const diagnostics = compileVirtualUsage(`${REQUIRED_UNION_PREAMBLE}
const pkg: UnacceptedEvidencePackage<RequiredGateId, RequiredArtifactPath> = {${PACKAGE_BASE_FIELDS}
  accepted: false,
  requiredGates: { typecheck: skipped },
  requiredBuildArtifacts: {},
}
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('documents the honest degraded case: with RequiredGateId/RequiredArtifactPath left at their string default, an AcceptedEvidencePackage literal with EMPTY requiredGates and requiredBuildArtifacts maps still type-checks -- completeness of a non-literal required-id SET is a P-stage runtime check (verify-evidence.mjs against the release manifest), never a static one this type surface can express', () => {
    const diagnostics = compileVirtualUsage(`${FIXTURE_PREAMBLE}
const pkg: AcceptedEvidencePackage = {${PACKAGE_BASE_FIELDS}
  accepted: true,
  requiredGates: {},
  requiredBuildArtifacts: {},
}
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })
})

describe('EvidencePackage round-trips through JSON (Epic P0-07 acceptance[1], offline verification)', () => {
  it('declares no unique-symbol-branded member anywhere in the module -- every field is a plain JSON-safe value, so JSON.stringify never silently drops it', () => {
    // Unlike @deepseek-ai/dsh-trust-kernel's opaque capability handles
    // (deliberately un-exported `unique symbol` property keys, which
    // JSON.stringify drops entirely), an EvidencePackage is written to disk
    // and verified fully offline -- it must round-trip through JSON, so no
    // exported type here may use that pattern.
    let foundUniqueSymbol = false
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.UniqueKeyword) foundUniqueSymbol = true
      ts.forEachChild(node, visit)
    }
    visit(typesSourceFileAst)
    expect(foundUniqueSymbol, 'src/types.ts must declare no `unique symbol`').toBe(false)
  })
})

describe('src/index.ts (Epic P0-07 C-stage B4(f) scaffold)', () => {
  it('is exactly one statement: `export type * from \'./types.ts\'` -- zero runtime exports, zero Cordis registration, zero side effects', () => {
    const realStatements = indexSourceFileAst.statements
    expect(realStatements, 'src/index.ts top-level statements').toHaveLength(1)
    const [statement] = realStatements
    expect(ts.isExportDeclaration(statement!), 'the one statement must be an export declaration').toBe(true)
    const exportDecl = statement as ts.ExportDeclaration
    expect(exportDecl.isTypeOnly, 'must be `export type *`, not a runtime re-export').toBe(true)
    expect(exportDecl.exportClause, 'must be a bare `export type *`, not a named re-export list').toBeUndefined()
    expect((exportDecl.moduleSpecifier as ts.StringLiteral).text).toBe('./types.ts')
  })

  it('has no default export and no Config/apply plugin exports', () => {
    const hasDefaultExport = indexSourceFileAst.statements.some(statement => ts.isExportAssignment(statement))
    expect(hasDefaultExport, 'export default').toBe(false)
    const hasApplyExport = indexSourceFileAst.statements.some((statement) => {
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) return statement.name?.text === 'apply'
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        return statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'apply')
      }
      return false
    })
    expect(hasApplyExport, 'exported apply plugin entry').toBe(false)
  })
})

describe('release/collect-evidence + verify-evidence (Epic P0-07 P-stage)', () => {
  const baselineScriptPath = resolve(import.meta.dirname, '../../scripts/release/baseline-fingerprint.mjs')
  const collectScriptPath = resolve(import.meta.dirname, '../../scripts/release/collect-evidence.mjs')
  const verifyScriptPath = resolve(import.meta.dirname, '../../scripts/release/verify-evidence.mjs')

  const fixtureRoots: string[] = []
  afterEach(() => {
    for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }).trim()
  }

  function write(root: string, relPath: string, content: string): void {
    const full = join(root, relPath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  /** A minimal but structurally realistic checkout `scripts/release/baseline-fingerprint.mjs capture` can succeed against, mirroring `tests/release/baseline-fingerprint.spec.ts`'s own fixture shape. */
  function makeEvidenceFixture(): { root: string, baseSha: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))
    fixtureRoots.push(root)
    git(root, ['init', '--initial-branch=main'])
    git(root, ['config', 'user.email', 'evidence-fixture@example.com'])
    git(root, ['config', 'user.name', 'Evidence Fixture'])
    git(root, ['config', 'commit.gpgsign', 'false'])
    write(root, 'package.json', `${JSON.stringify({ name: '@fixture/root', private: true, packageManager: 'pnpm@11.7.0' }, null, 2)}\n`)
    write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
    write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n')
    write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n}\n')
    write(root, 'packages/core/session/src/known-event-types.ts', "export type KnownEventType = 'session.start'\n")
    write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'fixture baseline'])
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    // `collect-evidence init` requires a real build-artifact-capable checkout
    // and, via `verifyBaseline`, a captured baseline whose gitSha equals the
    // CURRENT HEAD -- so a real second commit (simulating the release's own
    // work) must land, and `baseline:capture` must run, before `init`.
    write(root, 'lib/index.js', "console.log('build output')\n")
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'add build output'])
    return { root, baseSha }
  }

  function captureBaseline(root: string): void {
    const result = spawnSync(process.execPath, [baselineScriptPath, 'capture', '--repo-root', root], { encoding: 'utf8' })
    expect(result.status, `baseline capture stderr: ${result.stderr}`).toBe(0)
  }

  function collectInit(root: string, baseSha: string, requiredGates: readonly string[], requiredArtifacts: readonly string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [
      collectScriptPath, 'init', '--repo-root', root, '--base-sha', baseSha,
      ...requiredGates.flatMap(id => ['--required-gate', id]),
      ...requiredArtifacts.flatMap(path => ['--required-artifact', path]),
    ], { encoding: 'utf8' })
  }

  function collectRun(root: string, gateId: string, extraFlags: readonly string[], command: readonly string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [collectScriptPath, 'run', '--repo-root', root, '--gate-id', gateId, ...extraFlags, '--', ...command], { encoding: 'utf8' })
  }

  function collectBuildArtifact(root: string, path: string): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [collectScriptPath, 'build-artifact', '--repo-root', root, '--path', path], { encoding: 'utf8' })
  }

  function verifyEvidence(root: string, evidenceRelPath = '.dsh/evidence/evidence.json'): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [verifyScriptPath, '--repo-root', root, '--evidence', evidenceRelPath], { encoding: 'utf8' })
  }

  /** The real runtime shape this test suite inspects -- deliberately plain `string`/`number` leaves, never the branded C-stage types: a `Digest`/`GateId`/`CommitSha` brand is compile-time-only and can never be recovered from parsed JSON (see the type-checking `describe` block below for how this suite instead proves the real collected structure against the branded types). */
  interface CollectedGateEvidence {
    readonly gateId: string
    readonly command: string
    readonly startedAt: string
    readonly endedAt: string
    readonly environment: unknown
    readonly outcome: 'completed' | 'skipped' | 'missing'
    readonly exitCode: number | null
    readonly logDigest: string | null
    readonly artifacts: readonly unknown[]
    readonly testCounts: { total: number, passed: number, failed: number, skipped: number } | null
    readonly skipReasons: readonly string[]
  }

  interface CollectedEvidencePackage {
    readonly accepted: boolean
    readonly baselineFingerprint: { readonly gitSha: string, readonly digest: string }
    readonly gitDiff: { readonly baseSha: string, readonly headSha: string, readonly digest: string }
    readonly requiredGates: Record<string, CollectedGateEvidence>
    readonly requiredBuildArtifacts: Record<string, string>
  }

  function readEvidence(root: string): CollectedEvidencePackage {
    return JSON.parse(readFileSync(join(root, '.dsh/evidence/evidence.json'), 'utf8')) as CollectedEvidencePackage
  }

  /** A trivial cross-platform "gate": a Node script invoked as `node <path>`, never a shell script (no POSIX-shell/chmod dependency, so this runs on Windows too). */
  function writeGateScript(root: string, relPath: string, body: string): string {
    const full = join(root, relPath)
    write(root, relPath, body)
    return full
  }

  describe('round-trip: real collect-then-verify produces a genuinely accepted, offline-verifiable EvidencePackage', () => {
    it('seeds every declared required gate as a MissingGateEvidence placeholder at init, keeping accepted=false until each one actually runs', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['typecheck', 'test'], ['lib/index.js'])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)

      const pkg = readEvidence(root)
      expect(pkg.accepted).toBe(false)
      const typecheckGate = pkg.requiredGates.typecheck!
      const testGate = pkg.requiredGates.test!
      expect(typecheckGate.outcome).toBe('missing')
      expect(typecheckGate.skipReasons).toEqual(['not yet attempted'])
      expect(testGate.outcome).toBe('missing')
      expect(pkg.baselineFingerprint.gitSha).toBe(git(root, ['rev-parse', 'HEAD']))
      expect(pkg.gitDiff.baseSha).toBe(baseSha)

      const verifyResult = verifyEvidence(root)
      expect(verifyResult.status, `an honestly-incomplete package must still verify clean: ${verifyResult.stdout}`).toBe(0)
    })

    it('collects two real gate runs and a real build-artifact digest into accepted=true, then verifies fully offline', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['typecheck', 'test'], ['lib/index.js'])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)

      const typecheckScript = writeGateScript(root, 'typecheck-gate.mjs', "console.log('typecheck ok'); process.exit(0)")
      const typecheckResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, typecheckScript])
      expect(typecheckResult.status, `typecheck run stderr: ${typecheckResult.stderr}`).toBe(0)

      write(root, 'test-counts.json', JSON.stringify({ total: 3, passed: 3, failed: 0, skipped: 0 }))
      const testScript = writeGateScript(root, 'test-gate.mjs', "console.log('test ok'); process.exit(0)")
      const testResult = collectRun(root, 'test', ['--required', '--test-counts', 'test-counts.json'], [process.execPath, testScript])
      expect(testResult.status, `test run stderr: ${testResult.stderr}`).toBe(0)

      expect(readEvidence(root).accepted, 'still incomplete: the required build artifact has not been recorded yet').toBe(false)

      const buildResult = collectBuildArtifact(root, 'lib/index.js')
      expect(buildResult.status, `build-artifact stderr: ${buildResult.stderr}`).toBe(0)

      const pkg = readEvidence(root)
      expect(pkg.accepted).toBe(true)
      expect(pkg.requiredGates.typecheck!.outcome).toBe('completed')
      expect(pkg.requiredGates.typecheck!.exitCode).toBe(0)
      expect(pkg.requiredGates.test!.testCounts).toEqual({ total: 3, passed: 3, failed: 0, skipped: 0 })
      expect(pkg.requiredBuildArtifacts['lib/index.js']).toMatch(/^[0-9a-f]{64}$/)

      // acceptance[1]: fully offline -- delete the gate scripts collect-evidence
      // just ran; a verifier that re-ran them would now fail (ENOENT/module-not-found).
      unlinkSync(typecheckScript)
      unlinkSync(testScript)
      const verifyResult = verifyEvidence(root)
      expect(verifyResult.status, `offline verify stderr/stdout: ${verifyResult.stdout}${verifyResult.stderr}`).toBe(0)
      expect(verifyResult.stdout).toContain('no mismatches')
    })
  })

  describe('must[2] holds for real collected evidence, not only a compile-time literal', () => {
    it('never sets accepted=true when a required gate genuinely completes with a nonzero exit code', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['lint'], [])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)

      const lintScript = writeGateScript(root, 'lint-gate.mjs', "console.error('lint violations found'); process.exit(1)")
      const lintResult = collectRun(root, 'lint', ['--required'], [process.execPath, lintScript])
      expect(lintResult.status, 'collect run must propagate the real, failing exit code').toBe(1)

      const pkg = readEvidence(root)
      expect(pkg.requiredGates.lint!.outcome, 'a gate that ran to completion, even failing, is CompletedGateEvidence, not skipped/missing').toBe('completed')
      expect(pkg.requiredGates.lint!.exitCode).toBe(1)
      expect(pkg.accepted, 'a failing required gate must never yield accepted=true').toBe(false)

      const verifyResult = verifyEvidence(root)
      expect(verifyResult.status, 'an honestly-unaccepted package with no tampering must still verify clean').toBe(0)
    })

    it('records a --skip reason as SkippedGateEvidence without running any command, and keeps accepted=false', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['e2e'], [])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)

      const skipResult = collectRun(root, 'e2e', ['--required', '--skip', 'no DEEPSEEK_API_KEY'], [])
      expect(skipResult.status).toBe(0)

      const pkg = readEvidence(root)
      const e2eGate = pkg.requiredGates.e2e!
      expect(e2eGate.outcome).toBe('skipped')
      expect(e2eGate.skipReasons).toEqual(['no DEEPSEEK_API_KEY'])
      expect(e2eGate.exitCode).toBeNull()
      expect(e2eGate.logDigest).toBeNull()
      expect(pkg.accepted).toBe(false)
    })
  })

  describe('acceptance[0]: tampering with any referenced file after collection makes verify fail', () => {
    function collectOneAcceptedGate(): { root: string } {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['typecheck'], ['lib/index.js'])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
      const gatePath = writeGateScript(root, 'gate.mjs', "console.log('ok'); process.exit(0)")
      const runResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, gatePath])
      expect(runResult.status, `run stderr: ${runResult.stderr}`).toBe(0)
      const buildResult = collectBuildArtifact(root, 'lib/index.js')
      expect(buildResult.status, `build-artifact stderr: ${buildResult.stderr}`).toBe(0)
      expect(readEvidence(root).accepted).toBe(true)
      const clean = verifyEvidence(root)
      expect(clean.status, `precondition: must verify clean before tampering: ${clean.stdout}`).toBe(0)
      return { root }
    }

    it('detects a mutated byte in a completed gate\'s captured log file', () => {
      const { root } = collectOneAcceptedGate()
      const logPath = join(root, '.dsh/evidence/evidence.d/logs/typecheck.log')
      write(root, '.dsh/evidence/evidence.d/logs/typecheck.log', `${readFileSync(logPath, 'utf8')}TAMPERED\n`)

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('logDigest mismatch')
    })

    it('detects a mutated byte in a required build artifact after collection', () => {
      const { root } = collectOneAcceptedGate()
      write(root, 'lib/index.js', "console.log('TAMPERED')\n")

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('lib/index.js digest mismatch')
    })

    it('detects a hand-edited evidence.json itself: recordDigest, package signature, and the re-derived must[2] check all fail', () => {
      const { root } = collectOneAcceptedGate()
      const outPath = join(root, '.dsh/evidence/evidence.json')
      // A mutable local shape (unlike `CollectedEvidencePackage`'s `readonly`
      // fields) for the one thing this test deliberately corrupts.
      const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredGates: { typecheck: { exitCode: number } } }
      pkg.requiredGates.typecheck.exitCode = 1
      writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('recordDigest mismatch')
      expect(result.stdout).toContain('package signature mismatch')
      expect(result.stdout).toContain('not a passing CompletedGateEvidence')
    })
  })

  describe('the written evidence.json genuinely type-checks as EvidencePackage/AcceptedEvidencePackage -- real TypeScript types, not merely JSON-shaped-alike', () => {
    it('compiles with zero diagnostics when the real collected fields are branded per their declared types', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['typecheck'], ['lib/index.js'])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
      const gatePath = writeGateScript(root, 'gate.mjs', "console.log('ok'); process.exit(0)")
      const runResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, gatePath])
      expect(runResult.status, `run stderr: ${runResult.stderr}`).toBe(0)
      const buildResult = collectBuildArtifact(root, 'lib/index.js')
      expect(buildResult.status, `build-artifact stderr: ${buildResult.stderr}`).toBe(0)

      const pkg = readEvidence(root)
      expect(pkg.accepted).toBe(true)
      const gate = pkg.requiredGates.typecheck!

      // Real string leaves (command/timestamps/environment/artifact path) are
      // spliced in verbatim from the actual collected record; identifier and
      // digest leaves are branded via `declare const`, matching the C-stage
      // FIXTURE_PREAMBLE's own established pattern above -- JSON.stringify's
      // structural shape can never carry a compile-time-only phantom brand, so
      // this is the honest way to prove the real STRUCTURE (field names,
      // nesting, discriminant literals) compiles as the real type, without
      // pretending a parsed JSON literal can satisfy a branded field on its own.
      const diagnostics = compileVirtualUsage(`
import type { AcceptedEvidencePackage, CommitSha, Digest, GateEnvironment, GateId, Signature } from ${JSON.stringify(typesPath)}
declare const digest: Digest
declare const gitSha: CommitSha
declare const gateId: GateId
declare const signature: Signature
const pkg: AcceptedEvidencePackage = {
  formatVersion: 1,
  baselineFingerprint: { gitSha, digest },
  gitDiff: { baseSha: gitSha, headSha: gitSha, digest },
  additionalGates: [],
  requiredGates: {
    typecheck: {
      gateId,
      command: ${JSON.stringify(gate.command)},
      startedAt: ${JSON.stringify(gate.startedAt)},
      endedAt: ${JSON.stringify(gate.endedAt)},
      environment: ${JSON.stringify(gate.environment)} satisfies GateEnvironment,
      outcome: 'completed',
      exitCode: ${JSON.stringify(gate.exitCode)},
      logDigest: digest,
      artifacts: [],
      testCounts: null,
      skipReasons: [],
      recordDigest: digest,
    },
  },
  requiredBuildArtifacts: { ${JSON.stringify('lib/index.js')}: digest },
  accepted: true,
  signature,
}
`)
      expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
    })

    it('every collected GateEvidence record has exactly must[0]\'s real field set at runtime, matching CompletedGateEvidence\'s own declared members', () => {
      const { root, baseSha } = makeEvidenceFixture()
      captureBaseline(root)
      const initResult = collectInit(root, baseSha, ['typecheck'], [])
      expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
      const gatePath = writeGateScript(root, 'gate.mjs', "process.exit(0)")
      const runResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, gatePath])
      expect(runResult.status, `run stderr: ${runResult.stderr}`).toBe(0)

      const gate = readEvidence(root).requiredGates.typecheck!
      const [, completedOwnMembers] = GATE_EVIDENCE_VARIANTS.find(([name]) => name === 'CompletedGateEvidence')!
      expect(Object.keys(gate).toSorted()).toEqual([...GATE_EVIDENCE_BASE_MEMBERS, ...completedOwnMembers].toSorted())
    })
  })
})
