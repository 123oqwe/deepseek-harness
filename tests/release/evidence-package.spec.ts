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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
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

// Every case below runs the release scripts as subprocesses, and each verify
// re-derives the baseline fingerprint by running git, node and pnpm, so a
// loaded runner can pass the default 5 s budget without a fault.
describe('release/collect-evidence + verify-evidence (Epic P0-07 P-stage)', { timeout: 60_000 }, () => {
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

  /**
   * A minimal genuinely-accepted single-required-gate, single-required-artifact bundle, verified clean before returning -- the common starting point every tampering test below (P-stage's acceptance[0] block and F-stage's fault/qualification block alike) mutates from.
   * @param prepare - runs on the fixture before the baseline is captured, for a case that needs a commit or git configuration in place during collection.
   * @returns the fixture root.
   */
  function collectOneAcceptedGate(prepare?: (root: string) => void): { root: string } {
    const { root, baseSha } = makeEvidenceFixture()
    prepare?.(root)
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

  describe('an unknown flag is refused by name, rather than silently eating the next argument', () => {
    // The parse happens before either script touches the filesystem, so these
    // cases need no fixture: a bogus root proves the refusal comes from the
    // flag and not from anything the run went on to find.
    const NOWHERE = '/nonexistent-evidence-root'

    it('collect-evidence refuses a misspelt flag and names it', () => {
      const result = spawnSync(process.execPath, [
        collectScriptPath, 'init', '--repo-root', NOWHERE, '--base-sha', 'a'.repeat(40), '--requird-gate', 'typecheck',
      ], { encoding: 'utf8' })
      expect(result.status, `stdout: ${result.stdout}`).not.toBe(0)
      expect(result.stderr).toContain('--requird-gate')
    })

    it('THE REASON: the misspelt flag would otherwise have swallowed the value of the one after it', () => {
      // `--requird-gate` takes `typecheck` as its own value, so `--required-gate`
      // then takes `test` and the package records ONE required gate where the
      // caller asked for two. Nothing fails, nothing warns, and the release
      // gate is quietly weaker than the command that produced it.
      const result = spawnSync(process.execPath, [
        collectScriptPath, 'init', '--repo-root', NOWHERE, '--base-sha', 'a'.repeat(40),
        '--requird-gate', 'typecheck', '--required-gate', 'test',
      ], { encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('--requird-gate')
    })

    it('verify-evidence refuses one too, where every unknown flag consumes the next argument', () => {
      // This parser declares no boolean flags at all, so the exposure is wider
      // than collect-evidence's: there is no token it treats as valueless.
      const result = spawnSync(process.execPath, [
        verifyScriptPath, '--repo-rot', NOWHERE, '--evidence', '.dsh/evidence/evidence.json',
      ], { encoding: 'utf8' })
      expect(result.status, `stdout: ${result.stdout}`).not.toBe(0)
      expect(result.stderr).toContain('--repo-rot')
    })

    it('CONTROL: the correctly spelt flags are still accepted, so the guard refuses typos and not the vocabulary', () => {
      // Without this, a guard that refused EVERYTHING would satisfy the three
      // cases above. Both scripts get past the parse and fail later, on the
      // root that does not exist -- a different failure, which is the point.
      const collect = spawnSync(process.execPath, [
        collectScriptPath, 'init', '--repo-root', NOWHERE, '--base-sha', 'a'.repeat(40), '--required-gate', 'typecheck',
      ], { encoding: 'utf8' })
      expect(collect.stderr).not.toContain('unknown flag')
      const verify = spawnSync(process.execPath, [
        verifyScriptPath, '--repo-root', NOWHERE, '--evidence', '.dsh/evidence/evidence.json',
      ], { encoding: 'utf8' })
      expect(verify.stderr).not.toContain('unknown flag')
    })
  })

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

      // Outside the checkout: the package binds the working tree, so scripts
      // deleted from inside it below would be a change after collection.
      const gates = mkdtempSync(join(tmpdir(), 'dsh-evidence-gates-'))
      fixtureRoots.push(gates)
      const typecheckScript = writeGateScript(gates, 'typecheck-gate.mjs', "console.log('typecheck ok'); process.exit(0)")
      const typecheckResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, typecheckScript])
      expect(typecheckResult.status, `typecheck run stderr: ${typecheckResult.stderr}`).toBe(0)

      write(root, 'test-counts.json', JSON.stringify({ total: 3, passed: 3, failed: 0, skipped: 0 }))
      const testScript = writeGateScript(gates, 'test-gate.mjs', "console.log('test ok'); process.exit(0)")
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

    it('detects a mutated .dsh/baseline.json after collection', () => {
      const { root } = collectOneAcceptedGate()
      // Still valid JSON; only the bytes the package's baselineFingerprint digest binds have changed.
      const baselinePath = join(root, '.dsh/baseline.json')
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, unknown>
      baseline.pnpmLockHash = '0'.repeat(64)
      writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('baselineFingerprint digest mismatch')
    })

    it('detects a mutated gitdiff.patch sidecar after collection', () => {
      const { root } = collectOneAcceptedGate()
      const diffPath = join(root, '.dsh/evidence/evidence.d/gitdiff.patch')
      write(root, '.dsh/evidence/evidence.d/gitdiff.patch', `${readFileSync(diffPath, 'utf8')}+TAMPERED\n`)

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('gitDiff digest mismatch')
    })
  })

  describe('acceptance[0]: configuration the package binds, changed after collection, makes verify fail', () => {
    // Each row changes one input `baseline-fingerprint.mjs` fingerprints and
    // leaves `.dsh/baseline.json` itself alone, so verify can only report it by
    // re-deriving the fingerprint from the checkout. The lockfile and schema
    // contents are the ones `tests/release/baseline-fingerprint.spec.ts` uses.
    const CONFIGURATION_CHANGES: readonly (readonly [label: string, reported: string, change: (root: string) => void])[] = [
      ['pnpm-lock.yaml content', 'pnpm-lock.yaml (pnpmLockHash)', (root) => {
        write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages:\n  tampered: true\n")
      }],
      ['a protocol schema file', 'packages/sdk/protocol/src/types.ts (protocolSchemaHashes)', (root) => {
        write(root, 'packages/sdk/protocol/src/types.ts', 'export interface Envelope {\n  kind: string\n  tampered: true\n}\n')
      }],
      ['a default bundle row id', 'packages/bundle/base/cordis.patch.yml (defaultBundleRowIds)', (root) => {
        write(root, 'packages/bundle/base/cordis.patch.yml', 'rows:\n  - id: row-alpha\n  - id: row-beta\n')
      }],
      // The field only: `baseline-fingerprint.mjs` owns which path a
      // workspace-set drift names.
      ['the workspace package set', '(workspacePackages)', (root) => {
        write(root, 'packages/extra/package.json', `${JSON.stringify({ name: '@fixture/extra' })}\n`)
      }],
      ['HEAD (a new commit)', 'HEAD (gitSha)', (root) => {
        git(root, ['commit', '--allow-empty', '-m', 'a commit after collection'])
      }],
    ]

    it.each(CONFIGURATION_CHANGES)('detects %s changed after collection, with .dsh/baseline.json itself untouched', (_label, reported, change) => {
      const { root } = collectOneAcceptedGate()
      change(root)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('baseline drift since collection: ')
      expect(result.stdout).toContain(reported)
      expect(result.stdout).not.toContain('baselineFingerprint digest mismatch')
    })

    // Both edits leave valid JSON. The `requiredArtifactPaths` row is one no
    // cross-check can replace: `build-artifact` records any path it is given,
    // so the package alone does not say which paths `init` declared.
    const MANIFEST_EDITS: readonly (readonly [label: string, field: 'requiredGateIds' | 'requiredArtifactPaths'])[] = [
      ['requiredGateIds (the required gate dropped)', 'requiredGateIds'],
      ['requiredArtifactPaths (the recorded required artifact dropped)', 'requiredArtifactPaths'],
    ]

    it.each(MANIFEST_EDITS)('detects the manifest sidecar\'s %s edited after collection', (_label, field) => {
      const { root } = collectOneAcceptedGate()
      const manifestPath = join(root, '.dsh/evidence/evidence.d/manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { requiredArtifactPaths: string[], requiredGateIds: string[] }
      expect(manifest[field], 'precondition: the list this edit empties is not empty already').not.toHaveLength(0)
      writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, [field]: [] }, null, 2)}\n`)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('sidecar manifest digest mismatch')
    })
  })

  describe('acceptance[2] (narrowed): the result line of verify names the package path and its accepted status', () => {
    const RESULT_LINES: readonly (readonly [label: string, prepare: () => string, status: number, accepted: string])[] = [
      ['an accepted package that verifies clean', () => collectOneAcceptedGate().root, 0, 'accepted=true'],
      ['a package that verifies clean and is not accepted', () => {
        const { root, baseSha } = makeEvidenceFixture()
        captureBaseline(root)
        expect(collectInit(root, baseSha, ['e2e'], []).status).toBe(0)
        expect(collectRun(root, 'e2e', ['--required', '--skip', 'no DEEPSEEK_API_KEY'], []).status).toBe(0)
        expect(readEvidence(root).accepted, 'precondition: a skipped required gate leaves the package unaccepted').toBe(false)
        return root
      }, 0, 'accepted=false'],
      ['an accepted package that fails verification', () => {
        const { root } = collectOneAcceptedGate()
        const logPath = join(root, '.dsh/evidence/evidence.d/logs/typecheck.log')
        writeFileSync(logPath, `${readFileSync(logPath, 'utf8')}TAMPERED\n`)
        return root
      }, 1, 'accepted=false'],
    ]

    it.each(RESULT_LINES)('prints the package path and its accepted status on its result line (%s)', (_label, prepare, status, accepted) => {
      const root = prepare()

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(status)
      const [resultLine] = result.stdout.split('\n')
      if (resultLine === undefined) throw new Error(`verify printed no result line:\n${result.stdout}`)
      expect(resultLine).toContain(join(root, '.dsh/evidence/evidence.json'))
      expect(resultLine).toContain(accepted)
      const printsAccepted = resultLine.includes('accepted=true')
      expect(status === 0 || !printsAccepted, 'a package that failed verification is not accepted, whatever it records').toBe(true)
    })

    it('fails with a named mismatch and still prints its result line when pnpm cannot run', () => {
      const { root } = collectOneAcceptedGate()
      // A pnpm that cannot run, first on PATH: re-deriving the baseline needs it.
      const bin = mkdtempSync(join(tmpdir(), 'dsh-no-pnpm-'))
      fixtureRoots.push(bin)
      writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 127\n', { mode: 0o755 })

      const result = spawnSync(process.execPath, [verifyScriptPath, '--repo-root', root, '--evidence', '.dsh/evidence/evidence.json'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` },
      })
      expect(result.status, result.stdout).toBe(1)
      const [resultLine] = result.stdout.split('\n')
      expect(resultLine).toContain(join(root, '.dsh/evidence/evidence.json'))
      expect(resultLine).toContain('accepted=false')
      expect(result.stdout).toContain('baseline re-derivation failed')
    })

    it('still prints its result line when the package is valid JSON without the fields verify reads', () => {
      const { root } = collectOneAcceptedGate()
      writeFileSync(join(root, '.dsh/evidence/evidence.json'), '{}\n')

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      const [resultLine] = result.stdout.split('\n')
      expect(resultLine).toContain(join(root, '.dsh/evidence/evidence.json'))
      expect(resultLine).toContain('accepted=false')
      expect(result.stdout).toContain('verify could not complete')
    })
  })

  describe('acceptance[0]: the working tree is checked against the diff recorded at collection', () => {
    it('detects an uncommitted change to the root package.json made after collection', () => {
      const { root } = collectOneAcceptedGate()
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
      write(root, 'package.json', `${JSON.stringify({ ...manifest, pnpm: { overrides: { 'left-pad': '1.0.0' } } }, null, 2)}\n`)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    it('detects an untracked configuration file added after the last collection step', () => {
      const { root } = collectOneAcceptedGate()
      write(root, '.npmrc', 'registry=https://registry.invalid/\n')

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    /**
     * A program git may run in place of its own diff output: it prints the same line whatever it is given.
     * @returns the program's path, outside the checkout.
     */
    function constantProgram(): string {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-constant-diff-'))
      fixtureRoots.push(dir)
      const path = join(dir, 'constant.sh')
      writeFileSync(path, '#!/bin/sh\necho CONSTANT\n', { mode: 0o755 })
      return path
    }

    /**
     * Configure git, in the checkout's own config, to run an external diff program in place of its diff.
     * @param root - the checkout.
     * @param program - the program.
     */
    function useExternalDiff(root: string, program: string): void {
      git(root, ['config', 'diff.external', program])
    }

    /**
     * Configure git, in the checkout's own config, to show every file through a textconv filter.
     * @param root - the checkout.
     * @param program - the filter.
     */
    function useTextconv(root: string, program: string): void {
      git(root, ['config', 'diff.constant.textconv', program])
      writeFileSync(join(root, '.git/info/attributes'), '* diff=constant\n')
    }

    /**
     * Pin a dependency in the root package.json, a file the base holds and the baseline fingerprint does not cover.
     * @param root - the checkout.
     */
    function addOverride(root: string): void {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
      write(root, 'package.json', `${JSON.stringify({ ...manifest, pnpm: { overrides: { 'left-pad': '1.0.0' } } }, null, 2)}\n`)
    }

    // An external diff program replaces git's whole output, so it hides a change to any file whose output was already
    // there at collection. A textconv filter hides a change only to a file the base holds: for an added or untracked
    // file git still prints the real blob id on the patch's index line.
    type ReplacedDiffOutput = readonly [label: string, configure: (root: string, program: string) => void, change: (root: string) => void]
    const REPLACED_DIFF_OUTPUT: readonly ReplacedDiffOutput[] = [
      ['an external diff program, for a tracked file that differs from the base', useExternalDiff, (root) => { write(root, 'notes.md', 'changed\n') }],
      ['an external diff program, for an untracked file', useExternalDiff, (root) => { write(root, 'untracked-notes.md', 'changed\n') }],
      ['a textconv filter, for a tracked file the base holds', useTextconv, addOverride],
    ]

    it.each(REPLACED_DIFF_OUTPUT)('detects a change after collection when git shows files through %s', (_label, configure, change) => {
      const program = constantProgram()
      // Configured before collection, so the recorded patch is taken the same way.
      const { root } = collectOneAcceptedGate((fixture) => {
        write(fixture, 'notes.md', 'tracked\n')
        git(fixture, ['add', 'notes.md'])
        git(fixture, ['commit', '-m', 'add notes'])
        write(fixture, 'untracked-notes.md', 'untracked\n')
        configure(fixture, program)
      })
      change(root)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    it.each([['skip-worktree'], ['assume-unchanged']])('refuses a checkout whose index marks a file %s, since git diff then reads the index for it', (flag) => {
      const { root } = collectOneAcceptedGate()
      git(root, ['update-index', `--${flag}`, 'package.json'])
      addOverride(root)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('skip-worktree or assume-unchanged')
    })

    it('detects a .gitignore added after collection that ignores itself and the file beside it', () => {
      const { root } = collectOneAcceptedGate()
      write(root, 'sub/.gitignore', '*\n')
      write(root, 'sub/.npmrc', 'registry=https://registry.invalid/\n')

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    it('refuses an untracked symbolic link to a directory, for which git produces no patch', () => {
      const { root } = collectOneAcceptedGate()
      symlinkSync('lib', join(root, 'lib-link'), 'dir')

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('working-tree diff re-derivation failed')
    })

    /**
     * A path git would write to if an option-shaped commit id reached it as `--output=<path>`.
     * @returns the path, in a directory that exists and is cleaned up.
     */
    function injectionTarget(): string {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-evidence-inject-'))
      fixtureRoots.push(dir)
      return join(dir, 'written-by-git')
    }

    it('refuses a package whose gitDiff.baseSha is not a commit id, and hands it to no git command', () => {
      const { root } = collectOneAcceptedGate()
      const target = injectionTarget()
      const evidencePath = join(root, '.dsh/evidence/evidence.json')
      const pkg = JSON.parse(readFileSync(evidencePath, 'utf8')) as { gitDiff: Record<string, unknown> }
      writeFileSync(evidencePath, `${JSON.stringify({ ...pkg, gitDiff: { ...pkg.gitDiff, baseSha: `--output=${target}` } }, null, 2)}\n`)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('is not a 40- or 64-digit hex commit id')
      expect(existsSync(target)).toBe(false)
    })

    it('does not let an option-shaped --base-sha reach git as an option when collecting', () => {
      const { root } = makeEvidenceFixture()
      captureBaseline(root)
      const target = injectionTarget()

      const result = collectInit(root, `--output=${target}`, ['typecheck'], ['lib/index.js'])
      expect(result.status, result.stderr).not.toBe(0)
      expect(existsSync(target)).toBe(false)
    })

    /**
     * Write an executable shell script outside the checkout.
     * @param name - the script's file name.
     * @param body - the script after its `#!/bin/sh` line.
     * @returns the script's path.
     */
    function outsideScript(name: string, body: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-evidence-git-'))
      fixtureRoots.push(dir)
      const path = join(dir, name)
      writeFileSync(path, `#!/bin/sh\n${body}`, { mode: 0o755 })
      return path
    }

    it('detects a same-size change after collection when the checkout\'s git compares only size and whole-second mtime', () => {
      // The root package.json is at the base, so git may take it from the index when its stat looks unchanged, and its
      // recorded mtime is older than the index, so git's racy-timestamp check does not reread it.
      const { root } = collectOneAcceptedGate((fixture) => {
        const past = new Date(Date.now() - 3_600_000)
        utimesSync(join(fixture, 'package.json'), past, past)
        git(fixture, ['add', 'package.json'])
        git(fixture, ['config', 'core.checkStat', 'minimal'])
        git(fixture, ['config', 'core.trustCtime', 'false'])
      })
      const path = join(root, 'package.json')
      const { atime, mtime } = statSync(path)
      writeFileSync(path, readFileSync(path, 'utf8').replace('@fixture/root', '@fixture/ROOT'))
      utimesSync(path, atime, mtime)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    it('detects a change after collection when the checkout\'s git trusts an fsmonitor hook that reports none', () => {
      const hook = outsideScript('fsmonitor.sh', "printf 'constant-token\\0'\n")
      const { root } = collectOneAcceptedGate((fixture) => {
        git(fixture, ['config', 'core.fsmonitor', hook])
        git(fixture, ['update-index', '--fsmonitor'])
        git(fixture, ['status', '--porcelain'])
      })
      addOverride(root)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })

    it('refuses a checkout that assigns a filter to a path, since git compares a filtered file by what the filter prints', () => {
      const { root } = collectOneAcceptedGate()
      const saved = mkdtempSync(join(tmpdir(), 'dsh-evidence-saved-'))
      fixtureRoots.push(saved)
      const original = join(saved, 'package.json')
      writeFileSync(original, readFileSync(join(root, 'package.json')))
      const restore = outsideScript('restore.sh', `cat >/dev/null\ncat '${original}'\n`)
      writeFileSync(join(root, '.git/info/attributes'), 'package.json filter=restore\n')
      git(root, ['config', 'filter.restore.clean', restore])
      addOverride(root)

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('assigns a filter')
    })

    it('detects a file added after collection that only a rule outside the tree ignores', () => {
      const { root } = collectOneAcceptedGate()
      writeFileSync(join(root, '.git/info/exclude'), 'local.cfg\n')
      write(root, 'local.cfg', 'registry=https://registry.invalid/\n')

      const result = verifyEvidence(root)
      expect(result.status, result.stdout).toBe(1)
      expect(result.stdout).toContain('the working tree differs from the diff recorded at collection')
    })
  })

  describe('Epic P0-07 F-stage: must[2] fault/qualification hardening beyond acceptance[0]\'s existing coverage', () => {
    /**
     * An independent re-implementation of `collect-evidence.mjs`'s own
     * canonical-JSON sha256 digest (sorted object keys, compact
     * serialization) -- deliberately NOT imported from that script (this
     * F-stage slice's declared files are only this spec and
     * `verify-evidence.mjs`; see the Writer report's BLOCKED-012-class
     * finding for why a real fix touching `collect-evidence.mjs` was not
     * self-approved). Recomputing the algorithm here, rather than importing
     * it, is also the more faithful adversarial model: a real forger reads
     * the published algorithm and reimplements it, exactly as this helper
     * does, and needs no secret key to do so (see `collect-evidence.mjs`'s
     * own module doc for this already-documented signature limitation).
     */
    function sortKeysDeep(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(sortKeysDeep)
      if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(obj).toSorted()) sorted[key] = sortKeysDeep(obj[key])
        return sorted
      }
      return value
    }
    function digestOfValue(value: unknown): string {
      return createHash('sha256').update(JSON.stringify(sortKeysDeep(value)), 'utf8').digest('hex')
    }
    /** Recomputes `pkg.signature` over the tampered package's own canonical serialization -- isolates a must[2] mismatch from the coarser top-level signature mismatch a naive hand-edit would also trigger (acceptance[0]'s already-covered "hand-edited evidence.json" case above). */
    function forgeSelfConsistentSignature(pkg: { signature?: unknown }): void {
      const { signature: _old, ...rest } = pkg
      ;(pkg as { signature: unknown }).signature = digestOfValue(rest)
    }

    describe('a required entry\'s raw bytes genuinely absent at verify time, distinct from acceptance[0]\'s merely-tampered-content cases', () => {
      it('detects a completed gate\'s captured log file deleted entirely, distinct from a merely mutated log', () => {
        const { root } = collectOneAcceptedGate()
        unlinkSync(join(root, '.dsh/evidence/evidence.d/logs/typecheck.log'))

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('log file missing at')
      })

      it('detects a required build artifact\'s file deleted entirely, distinct from a merely mutated one', () => {
        const { root } = collectOneAcceptedGate()
        unlinkSync(join(root, 'lib/index.js'))

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('required build artifact missing at lib/index.js')
      })

      it('detects a gate-level --artifact file deleted entirely after collection', () => {
        const { root, baseSha } = makeEvidenceFixture()
        captureBaseline(root)
        const initResult = collectInit(root, baseSha, ['typecheck'], [])
        expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
        write(root, 'coverage-report.txt', 'coverage: 100%\n')
        const gatePath = writeGateScript(root, 'gate.mjs', "console.log('ok'); process.exit(0)")
        const runResult = collectRun(root, 'typecheck', ['--required', '--artifact', 'coverage-report.txt'], [process.execPath, gatePath])
        expect(runResult.status, `run stderr: ${runResult.stderr}`).toBe(0)
        expect(readEvidence(root).requiredGates.typecheck!.artifacts).toHaveLength(1)

        unlinkSync(join(root, 'coverage-report.txt'))
        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('artifact missing at coverage-report.txt')
      })

      it('detects the manifest sidecar deleted entirely -- must[2] cannot be re-derived without its required-gate-id and required-artifact-path lists', () => {
        const { root } = collectOneAcceptedGate()
        unlinkSync(join(root, '.dsh/evidence/evidence.d/manifest.json'))

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('manifest sidecar missing at')
      })
    })

    describe('a skipped or silently-absent required entry must never coexist with accepted=true, even against a self-consistently forged package', () => {
      it('rejects a self-consistently forged package whose required gate is explicitly SkippedGateEvidence while accepted still claims true', () => {
        const { root } = collectOneAcceptedGate()
        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredGates: { typecheck: Record<string, unknown> }, signature?: unknown }
        const gate = pkg.requiredGates.typecheck
        gate.outcome = 'skipped'
        gate.exitCode = null
        gate.logDigest = null
        gate.artifacts = []
        gate.testCounts = null
        gate.skipReasons = ['forged: pretending this required gate was skipped']
        const { recordDigest: _oldRecordDigest, ...restOfRecord } = gate
        gate.recordDigest = digestOfValue(restOfRecord)
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('not a passing CompletedGateEvidence')
        expect(result.stdout).not.toContain('recordDigest mismatch')
        expect(result.stdout).not.toContain('package signature mismatch')
      })

      it('rejects a self-consistently forged package whose required gate has a nonzero exitCode while accepted still claims true', () => {
        const { root } = collectOneAcceptedGate()
        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredGates: { typecheck: Record<string, unknown> }, signature?: unknown }
        const gate = pkg.requiredGates.typecheck
        gate.exitCode = 1
        const { recordDigest: _oldRecordDigest, ...restOfRecord } = gate
        gate.recordDigest = digestOfValue(restOfRecord)
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('not a passing CompletedGateEvidence')
        expect(result.stdout).not.toContain('recordDigest mismatch')
        expect(result.stdout).not.toContain('package signature mismatch')
      })

      it('refuses a self-consistently forged package whose accepted is the string "true" rather than the boolean', () => {
        const { root, baseSha } = makeEvidenceFixture()
        captureBaseline(root)
        expect(collectInit(root, baseSha, ['e2e'], []).status).toBe(0)
        expect(collectRun(root, 'e2e', ['--required', '--skip', 'no DEEPSEEK_API_KEY'], []).status).toBe(0)
        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { accepted: unknown, signature?: unknown }
        expect(pkg.accepted, 'precondition: a skipped required gate leaves the package unaccepted').toBe(false)
        pkg.accepted = 'true'
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status, result.stdout).toBe(1)
        const [resultLine] = result.stdout.split('\n')
        expect(resultLine).toContain('accepted=false')
        expect(result.stdout).not.toContain('package signature mismatch')
      })

      it('detects a required gate silently deleted from requiredGates entirely, self-consistently forged so only the manifest cross-check catches it', () => {
        const { root, baseSha } = makeEvidenceFixture()
        captureBaseline(root)
        const initResult = collectInit(root, baseSha, ['typecheck', 'lint'], [])
        expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
        const typecheckPath = writeGateScript(root, 'typecheck-gate.mjs', "console.log('ok'); process.exit(0)")
        const typecheckResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, typecheckPath])
        expect(typecheckResult.status, `typecheck run stderr: ${typecheckResult.stderr}`).toBe(0)
        const lintPath = writeGateScript(root, 'lint-gate.mjs', "console.log('ok'); process.exit(0)")
        const lintResult = collectRun(root, 'lint', ['--required'], [process.execPath, lintPath])
        expect(lintResult.status, `lint run stderr: ${lintResult.stderr}`).toBe(0)
        expect(readEvidence(root).accepted, 'precondition: both required gates genuinely passed').toBe(true)
        const clean = verifyEvidence(root)
        expect(clean.status, `precondition: must verify clean before tampering: ${clean.stdout}`).toBe(0)

        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredGates: Record<string, unknown>, signature?: unknown }
        delete pkg.requiredGates.lint
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('accepted=true but required gate lint is missing from requiredGates entirely')
        expect(result.stdout).not.toContain('package signature mismatch')
      })

      it('detects a required build artifact silently deleted from requiredBuildArtifacts, self-consistently forged so only the manifest cross-check catches it', () => {
        const { root } = collectOneAcceptedGate()
        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredBuildArtifacts: Record<string, unknown>, signature?: unknown }
        delete pkg.requiredBuildArtifacts['lib/index.js']
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('accepted=true but required build artifact lib/index.js is not recorded in requiredBuildArtifacts')
        expect(result.stdout).not.toContain('package signature mismatch')
      })

      it('detects a required gate AND a required build artifact both silently deleted in the same self-consistently forged bundle, with both faults independently reported', () => {
        const { root, baseSha } = makeEvidenceFixture()
        captureBaseline(root)
        const initResult = collectInit(root, baseSha, ['typecheck', 'lint'], ['lib/index.js'])
        expect(initResult.status, `init stderr: ${initResult.stderr}`).toBe(0)
        const typecheckPath = writeGateScript(root, 'typecheck-gate.mjs', "console.log('ok'); process.exit(0)")
        const typecheckResult = collectRun(root, 'typecheck', ['--required'], [process.execPath, typecheckPath])
        expect(typecheckResult.status, `typecheck run stderr: ${typecheckResult.stderr}`).toBe(0)
        const lintPath = writeGateScript(root, 'lint-gate.mjs', "console.log('ok'); process.exit(0)")
        const lintResult = collectRun(root, 'lint', ['--required'], [process.execPath, lintPath])
        expect(lintResult.status, `lint run stderr: ${lintResult.stderr}`).toBe(0)
        const buildResult = collectBuildArtifact(root, 'lib/index.js')
        expect(buildResult.status, `build-artifact stderr: ${buildResult.stderr}`).toBe(0)
        expect(readEvidence(root).accepted, 'precondition: both required gates genuinely passed and the required artifact is genuinely recorded').toBe(true)
        const clean = verifyEvidence(root)
        expect(clean.status, `precondition: must verify clean before tampering: ${clean.stdout}`).toBe(0)

        const outPath = join(root, '.dsh/evidence/evidence.json')
        const pkg = JSON.parse(readFileSync(outPath, 'utf8')) as { requiredGates: Record<string, unknown>, requiredBuildArtifacts: Record<string, unknown>, signature?: unknown }
        delete pkg.requiredGates.lint
        delete pkg.requiredBuildArtifacts['lib/index.js']
        forgeSelfConsistentSignature(pkg)
        writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)

        const result = verifyEvidence(root)
        expect(result.status).toBe(1)
        expect(result.stdout).toContain('accepted=true but required gate lint is missing from requiredGates entirely')
        expect(result.stdout).toContain('accepted=true but required build artifact lib/index.js is not recorded in requiredBuildArtifacts')
        expect(result.stdout).not.toContain('package signature mismatch')
      })
    })

    it('detects and reports multiple independent fault types together in one bundle: a deleted gate log and a separately mutated build artifact', () => {
      const { root } = collectOneAcceptedGate()
      unlinkSync(join(root, '.dsh/evidence/evidence.d/logs/typecheck.log'))
      write(root, 'lib/index.js', "console.log('TAMPERED')\n")

      const result = verifyEvidence(root)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('log file missing at')
      expect(result.stdout).toContain('lib/index.js digest mismatch')
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
