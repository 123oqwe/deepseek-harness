/**
 * Contract-stage verification for Epic P0-05 (Shadow/Enforce feature gates).
 * `src/types.ts` has no runtime export at all -- it is a types-only module
 * per house convention -- so nothing here can construct a gate value and
 * inspect it live. Every check below is either a structural read of the
 * module's own AST (its exported shape, its top-level statement kinds, its
 * imports) or a real TypeScript compiler run against a small virtual usage
 * file that imports the real `src/types.ts` (and, for the settings-interop
 * checks, the real `packages/settings/settings/src/types.ts`) by absolute
 * path and asserts on the compiler's own diagnostics -- a genuine,
 * on-topic, runtime-executed proof of a compile-time guarantee, matching
 * what a types-only module can honestly test. `src/index.ts` has since grown
 * a real Provider-stage runtime surface alongside its unchanged type
 * re-export; see `tests/gates.provider.spec.ts` for that surface's own
 * acceptance cases. CLI/profile wiring (`--dump-config`, Usage stage)
 * remains a later slice's deliverable.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../../..')
const typesPath = resolve(packageRoot, 'src/types.ts')
const indexPath = resolve(packageRoot, 'src/index.ts')
const settingsTypesPath = resolve(repoRoot, 'packages/settings/settings/src/types.ts')
const utilValuesIndexPath = resolve(repoRoot, 'packages/util/values/src/index.ts')

const typesSource = readFileSync(typesPath, 'utf8')
const indexSource = readFileSync(indexPath, 'utf8')
const settingsTypesSource = readFileSync(settingsTypesPath, 'utf8')

const typesSourceFile = ts.createSourceFile(typesPath, typesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const indexSourceFile = ts.createSourceFile(indexPath, indexSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const settingsTypesSourceFile = ts.createSourceFile(settingsTypesPath, settingsTypesSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

/** Epic P0-05 must[0]'s three states, plus `id` on the declaration below. */
const REQUIRED_STATE_MEMBERS = ['off', 'shadow', 'enforce'].toSorted()

/** Epic P0-05 must[2]'s four owned fields, plus this contract's own `id`. */
const REQUIRED_DECLARATION_MEMBERS = ['id', 'owner', 'introducedVersion', 'defaultByProfile', 'removalVersion'].toSorted()

/** The four override sources this contract declares for must[3]'s chain. */
const REQUIRED_OVERRIDE_SOURCES = ['default', 'profile', 'settings', 'env'].toSorted()

/** Acceptance[1]'s sanitized shadow/legacy diff record -- exactly these fields, nothing raw. */
const REQUIRED_SHADOW_RECORD_MEMBERS = ['gateId', 'legacySummary', 'shadowSummary', 'differs'].toSorted()

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
}

function findExportedInterfaceIn(sourceFile: ts.SourceFile, name: string): ts.InterfaceDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name && hasExportModifier(statement),
  )
}

function findExportedInterface(name: string): ts.InterfaceDeclaration | undefined {
  return findExportedInterfaceIn(typesSourceFile, name)
}

function findExportedTypeAlias(name: string): ts.TypeAliasDeclaration | undefined {
  return typesSourceFile.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name && hasExportModifier(statement),
  )
}

/** Collect a union type alias's literal string members, e.g. `'off' | 'shadow' | 'enforce'`. */
function unionLiteralMembers(alias: ts.TypeAliasDeclaration): string[] {
  const type = alias.type
  if (!ts.isUnionTypeNode(type)) throw new Error(`${alias.name.text} is not a union type`)
  return type.types.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      throw new Error(`${alias.name.text} has a non-string-literal union member: ${member.getText(typesSourceFile)}`)
    }
    return member.literal.text
  })
}

/**
 * The real source-level resolution `src/types.ts` needs at runtime
 * (`@deepseek-ai/dsh-brand`, `@deepseek-ai/dsh-util-values`) -- the same two
 * entries `tsconfig.base.json`'s own `paths` map declares, kept minimal to
 * what this package's real source actually imports. The settings-interop
 * probe below deliberately imports `packages/settings/settings/src/types.ts`'s
 * `JsonValue`-typed field type directly from `@deepseek-ai/dsh-util-values`
 * rather than that module itself, so this probe never has to pull in that
 * module's `declare module '@deepseek-ai/cordis'` augmentation (and, through
 * it, the full vendored Cordis compilation) just to prove a field's value
 * type.
 */
const compilerProbeOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
  paths: {
    '@deepseek-ai/dsh-brand': [resolve(repoRoot, 'packages/util/brand/src')],
    '@deepseek-ai/dsh-util-values': [resolve(repoRoot, 'packages/util/values/src')],
  },
}

/**
 * Type-check a small virtual usage file that imports one or more real
 * modules by absolute path, and return the compiler's own diagnostics for
 * it -- independent of workspace package resolution or project references.
 */
function compileVirtualUsage(snippet: string): readonly ts.Diagnostic[] {
  const virtualDir = mkdtempSync(join(tmpdir(), 'feature-gates-contract-'))
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

/** Find a top-level `declare const <name>: ...` statement by the name of its sole declarator. */
function findAmbientConst(name: string): ts.VariableStatement | undefined {
  return typesSourceFile.statements.find(
    (statement): statement is ts.VariableStatement =>
      ts.isVariableStatement(statement)
      && (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
      && statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name),
  )
}

/**
 * Type-check a virtual `import * as T from '<types.ts>'` usage file and return the real
 * compiler's own list of `types.ts`'s exported names -- matching
 * `packages/kernel/trust-kernel/tests/boundary.spec.ts`'s own `typesModuleExportedNames`, a
 * genuine "the export list does not contain X" check, not a hand-maintained snapshot.
 */
function typesModuleExportedNames(): string[] {
  const virtualDir = mkdtempSync(join(tmpdir(), 'feature-gates-exports-'))
  const virtualPath = join(virtualDir, 'usage.ts')
  try {
    writeFileSync(virtualPath, `import * as T from ${JSON.stringify(typesPath)}\nT satisfies object\n`, 'utf8')
    const program = ts.createProgram([virtualPath], compilerProbeOptions)
    const checker = program.getTypeChecker()
    const virtualTypesSourceFile = program.getSourceFile(typesPath)
    if (virtualTypesSourceFile === undefined) throw new Error('virtual program did not resolve src/types.ts')
    const moduleSymbol = checker.getSymbolAtLocation(virtualTypesSourceFile)
    if (moduleSymbol === undefined) throw new Error('src/types.ts has no resolvable module symbol')
    return checker.getExportsOfModule(moduleSymbol).map(exported => exported.name)
  } finally {
    rmSync(virtualDir, { recursive: true, force: true })
  }
}

describe('FeatureGateState (Epic P0-05 must[0]: unified off|shadow|enforce)', () => {
  it('declares exactly three states: off, shadow, enforce -- no more, no fewer', () => {
    const alias = findExportedTypeAlias('FeatureGateState')
    expect(alias, 'exported FeatureGateState type alias').toBeDefined()
    expect(unionLiteralMembers(alias!).toSorted()).toEqual(REQUIRED_STATE_MEMBERS)
  })

  it('rejects a fourth state at compile time', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateState } from ${JSON.stringify(typesPath)}
const state: FeatureGateState = 'quarantine'
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('type-checks each of the three real states with zero diagnostics', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateState } from ${JSON.stringify(typesPath)}
const states: FeatureGateState[] = ['off', 'shadow', 'enforce']
states satisfies FeatureGateState[]
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })
})

describe('FeatureGateDeclaration (Epic P0-05 must[2]: owner/introducedVersion/defaultByProfile/removalVersion)', () => {
  it('declares an exported FeatureGateDeclaration interface with exactly the required fields, all readonly', () => {
    const decl = findExportedInterface('FeatureGateDeclaration')
    expect(decl, 'exported FeatureGateDeclaration interface').toBeDefined()
    expect(decl!.members.every(ts.isPropertySignature), 'FeatureGateDeclaration has only property signatures, no methods').toBe(true)
    const memberNames = decl!.members
      .filter(ts.isPropertySignature)
      .map(member => (member.name as ts.Identifier).text)
      .toSorted()
    expect(memberNames).toEqual(REQUIRED_DECLARATION_MEMBERS)
    for (const member of decl!.members.filter(ts.isPropertySignature)) {
      const isReadonly = member.modifiers?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false
      expect(isReadonly, `FeatureGateDeclaration.${(member.name as ts.Identifier).text} must be readonly`).toBe(true)
    }
  })

  it('rejects a well-formed declaration missing removalVersion at compile time', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateDeclaration } from ${JSON.stringify(typesPath)}
const gate: FeatureGateDeclaration = {
  id: 'x' as never,
  owner: 'team-harness',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'off' },
}
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('requires FeatureGateProfileDefaults to carry a "default" fallback entry', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateProfileDefaults } from ${JSON.stringify(typesPath)}
const profiles: FeatureGateProfileDefaults = { headless: 'shadow' }
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('type-checks a well-formed declaration with per-profile overrides and zero diagnostics', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateDeclaration } from ${JSON.stringify(typesPath)}
const gate: FeatureGateDeclaration = {
  id: 'permission-gate' as never,
  owner: 'team-harness',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'off', headless: 'shadow' },
  removalVersion: '0.2.0',
}
gate satisfies FeatureGateDeclaration
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })
})

describe('settings-namespace interop (Epic P0-05 must[3] "settings" override source, packages/settings/settings/src/types.ts)', () => {
  it('reads the real SettingsNamespaceView.value field type: JsonValue, from @deepseek-ai/dsh-util-values', () => {
    const view = findExportedInterfaceIn(settingsTypesSourceFile, 'SettingsNamespaceView')
    expect(view, 'exported SettingsNamespaceView interface in packages/settings/settings/src/types.ts').toBeDefined()
    const valueMember = view!.members.find(
      (m): m is ts.PropertySignature => ts.isPropertySignature(m) && (m.name as ts.Identifier).text === 'value',
    )
    expect(valueMember, 'SettingsNamespaceView.value member').toBeDefined()
    expect(ts.isTypeReferenceNode(valueMember!.type!), 'SettingsNamespaceView.value must be a type reference').toBe(true)
    const typeName = (valueMember!.type as ts.TypeReferenceNode).typeName
    expect(ts.isIdentifier(typeName) && typeName.text).toBe('JsonValue')
    const jsonValueImport = settingsTypesSourceFile.statements.find(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === '@deepseek-ai/dsh-util-values',
    )
    expect(jsonValueImport, 'SettingsNamespaceView.value\'s JsonValue must come from @deepseek-ai/dsh-util-values').toBeDefined()
  })

  it('keeps FeatureGateNamespaceValue JSON-safe: assignable to the real JsonValue that carries SettingsNamespaceView.value', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateNamespaceValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}

declare const gates: FeatureGateNamespaceValue
const value: JsonValue = gates
value satisfies JsonValue
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('rejects a non-state value inside FeatureGateNamespaceValue at compile time', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateNamespaceValue } from ${JSON.stringify(typesPath)}
const value: FeatureGateNamespaceValue = { 'my-gate': 'sideways' }
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })
})

describe('override chain / --dump-config (Epic P0-05 must[3])', () => {
  it('declares FeatureGateOverrideSource with exactly default, profile, settings, env', () => {
    const alias = findExportedTypeAlias('FeatureGateOverrideSource')
    expect(alias, 'exported FeatureGateOverrideSource type alias').toBeDefined()
    expect(unionLiteralMembers(alias!).toSorted()).toEqual(REQUIRED_OVERRIDE_SOURCES)
  })

  it('declares an exported FeatureGateResolution interface carrying gateId, resolved, and an ordered chain', () => {
    const decl = findExportedInterface('FeatureGateResolution')
    expect(decl, 'exported FeatureGateResolution interface').toBeDefined()
    const memberNames = decl!.members
      .filter(ts.isPropertySignature)
      .map(member => (member.name as ts.Identifier).text)
      .toSorted()
    expect(memberNames).toEqual(['chain', 'gateId', 'resolved'])
  })

  it('type-checks a well-formed resolution with its chain and rejects an unknown source', () => {
    const ok = compileVirtualUsage(`
import type { FeatureGateResolution } from ${JSON.stringify(typesPath)}
const resolution: FeatureGateResolution = {
  gateId: 'permission-gate' as never,
  resolved: { source: 'env', value: 'enforce' },
  chain: [
    { source: 'default', value: 'off' },
    { source: 'profile', value: 'shadow' },
    { source: 'settings', value: 'shadow' },
    { source: 'env', value: 'enforce' },
  ],
}
resolution satisfies FeatureGateResolution
`)
    expect(ok, diagnosticMessages(ok)).toHaveLength(0)

    const bad = compileVirtualUsage(`
import type { FeatureGateResolution } from ${JSON.stringify(typesPath)}
const resolution: FeatureGateResolution = {
  gateId: 'permission-gate' as never,
  resolved: { source: 'cli-flag', value: 'enforce' },
  chain: [],
}
`)
    expect(bad.length, diagnosticMessages(bad)).toBeGreaterThan(0)
  })
})

describe('shadow/legacy decision diff (Epic P0-05 acceptance[1]: complete diff)', () => {
  it('declares an exported FeatureGateShadowDecisionRecord with exactly gateId/legacySummary/shadowSummary/differs', () => {
    const decl = findExportedInterface('FeatureGateShadowDecisionRecord')
    expect(decl, 'exported FeatureGateShadowDecisionRecord interface').toBeDefined()
    const memberNames = decl!.members
      .filter(ts.isPropertySignature)
      .map(member => (member.name as ts.Identifier).text)
      .toSorted()
    expect(memberNames).toEqual(REQUIRED_SHADOW_RECORD_MEMBERS)
  })

  it.each(['legacySummary', 'shadowSummary'])(
    'types %s as RedactedJsonValue, never a bare JsonValue, unknown, or any',
    (fieldName) => {
      const decl = findExportedInterface('FeatureGateShadowDecisionRecord')
      const member = decl!.members.find(
        (m): m is ts.PropertySignature => ts.isPropertySignature(m) && (m.name as ts.Identifier).text === fieldName,
      )
      expect(member, `FeatureGateShadowDecisionRecord.${fieldName}`).toBeDefined()
      expect(member!.type?.kind).not.toBe(ts.SyntaxKind.UnknownKeyword)
      expect(member!.type?.kind).not.toBe(ts.SyntaxKind.AnyKeyword)
      expect(ts.isTypeReferenceNode(member!.type!), `${fieldName} must be a type reference (RedactedJsonValue)`).toBe(true)
      const typeName = (member!.type as ts.TypeReferenceNode).typeName
      expect(ts.isIdentifier(typeName) && typeName.text).toBe('RedactedJsonValue')
    },
  )

  it('rejects a raw unknown-typed payload field standing in for a summary', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateShadowDecisionRecord, RedactedJsonValue } from ${JSON.stringify(typesPath)}
declare const raw: unknown
const record: FeatureGateShadowDecisionRecord = {
  gateId: 'permission-gate' as never,
  legacySummary: raw,
  shadowSummary: { outcome: 'allow' } as RedactedJsonValue,
  differs: true,
}
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('type-checks a well-formed diff record with zero diagnostics once both summaries are typed JsonValue, then cast through RedactedJsonValue', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateShadowDecisionRecord, RedactedJsonValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}
const legacy: JsonValue = { outcome: 'allow' }
const shadow: JsonValue = { outcome: 'deny' }
const record: FeatureGateShadowDecisionRecord = {
  gateId: 'permission-gate' as never,
  legacySummary: legacy as RedactedJsonValue,
  shadowSummary: shadow as RedactedJsonValue,
  differs: true,
}
record satisfies FeatureGateShadowDecisionRecord
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })
})

describe('RedactedJsonValue (Epic P0-05 acceptance[1] "no sensitive-parameter leak": nominal brand over JsonValue)', () => {
  it('brands RedactedJsonValue with an unexported unique symbol -- an exported symbol would let any importer forge one with zero casts', () => {
    const decl = findAmbientConst('REDACTED_JSON_VALUE')
    expect(decl, 'declare const REDACTED_JSON_VALUE: unique symbol').toBeDefined()
    expect(
      hasExportModifier(decl!),
      'REDACTED_JSON_VALUE must not be exported -- an exported brand symbol lets any importer write '
      + '{ [REDACTED_JSON_VALUE]: true, ...anything } and satisfy RedactedJsonValue with zero casts',
    ).toBe(false)
  })

  it('exports RedactedJsonValue itself but never its brand symbol, per the real compiler\'s own module-exports list', () => {
    const names = typesModuleExportedNames()
    expect(names, `src/types.ts exported names: ${names.join(', ')}`).toContain('RedactedJsonValue')
    expect(names, `src/types.ts exported names: ${names.join(', ')}`).not.toContain('REDACTED_JSON_VALUE')
  })

  it('rejects a bare JsonValue assigned directly where RedactedJsonValue is required -- the accidental, un-cast leak path does not type-check', () => {
    const diagnostics = compileVirtualUsage(`
import type { RedactedJsonValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}
declare const rawDecisionParams: JsonValue
const value: RedactedJsonValue = rawDecisionParams
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('rejects an object literal assigned directly where RedactedJsonValue is required, same as a bare JsonValue', () => {
    const diagnostics = compileVirtualUsage(`
import type { RedactedJsonValue } from ${JSON.stringify(typesPath)}
const value: RedactedJsonValue = { apiKey: 'sk-not-redacted' }
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })

  it('accepts a JsonValue explicitly cast through RedactedJsonValue -- the deliberate, greppable escape hatch', () => {
    const diagnostics = compileVirtualUsage(`
import type { RedactedJsonValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}
declare const alreadyRedacted: JsonValue
const value: RedactedJsonValue = alreadyRedacted as RedactedJsonValue
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('does NOT verify cast content -- a value that still looks unredacted type-checks once cast, the documented, honest limit of this brand', () => {
    const diagnostics = compileVirtualUsage(`
import type { RedactedJsonValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}
const stillHoldsASecret: JsonValue = { apiKey: 'sk-not-actually-redacted' }
const value: RedactedJsonValue = stillHoldsASecret as RedactedJsonValue
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('stays assignable back to JsonValue -- a later analysis can read a RedactedJsonValue as ordinary JSON with zero diagnostics', () => {
    const diagnostics = compileVirtualUsage(`
import type { RedactedJsonValue } from ${JSON.stringify(typesPath)}
import type { JsonValue } from ${JSON.stringify(utilValuesIndexPath)}
declare const redacted: RedactedJsonValue
const value: JsonValue = redacted
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })
})

describe('release-gate expiry check (Epic P0-05 acceptance[2]: expired gate fails the release gate)', () => {
  it('declares FeatureGateExpiryStatus as exactly active|expired', () => {
    const alias = findExportedTypeAlias('FeatureGateExpiryStatus')
    expect(alias, 'exported FeatureGateExpiryStatus type alias').toBeDefined()
    expect(unionLiteralMembers(alias!).toSorted()).toEqual(['active', 'expired'])
  })

  it('declares FeatureGateExpiryCheck as (gate: FeatureGateDeclaration, releaseVersion: string) => FeatureGateExpiryStatus', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateDeclaration, FeatureGateExpiryCheck, FeatureGateExpiryStatus } from ${JSON.stringify(typesPath)}

const check: FeatureGateExpiryCheck = (gate: FeatureGateDeclaration, releaseVersion: string): FeatureGateExpiryStatus =>
  releaseVersion > gate.removalVersion ? 'expired' : 'active'
declare const gate: FeatureGateDeclaration
const status: FeatureGateExpiryStatus = check(gate, '0.2.0')
status satisfies FeatureGateExpiryStatus
`)
    expect(diagnostics, diagnosticMessages(diagnostics)).toHaveLength(0)
  })

  it('rejects a FeatureGateExpiryCheck implementation that returns something other than active/expired', () => {
    const diagnostics = compileVirtualUsage(`
import type { FeatureGateExpiryCheck } from ${JSON.stringify(typesPath)}
const check: FeatureGateExpiryCheck = () => 'unknown-status'
`)
    expect(diagnostics.length, diagnosticMessages(diagnostics)).toBeGreaterThan(0)
  })
})

describe('src/types.ts hygiene (Epic P0-05 Contract stage: types-only, no plugin surface)', () => {
  it('imports only via `import type`, never a runtime import', () => {
    const imports = typesSourceFile.statements.filter(ts.isImportDeclaration)
    expect(imports.length, 'src/types.ts must import at least Branded and JsonValue').toBeGreaterThan(0)
    for (const importDecl of imports) {
      expect(
        importDecl.importClause !== undefined && ts.isTypeOnlyImportDeclaration(importDecl.importClause),
        `${importDecl.getText(typesSourceFile)} must be a type-only import`,
      ).toBe(true)
    }
  })

  it('has no runtime code: every top-level statement is a type-only import, interface, type alias, or an ambient declare-const symbol', () => {
    for (const statement of typesSourceFile.statements) {
      const isTypeOnlyImport = ts.isImportDeclaration(statement)
        && statement.importClause !== undefined
        && ts.isTypeOnlyImportDeclaration(statement.importClause)
      const isTypeDecl = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
      // Matches packages/kernel/trust-kernel/tests/boundary.spec.ts's own hygiene check: an
      // ambient `declare const X: unique symbol` emits no runtime code (it is erased entirely),
      // the same opaque-brand idiom RedactedJsonValue uses below.
      const isAmbientConst = ts.isVariableStatement(statement)
        && (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
      const preview = statement.getText(typesSourceFile).split('\n')[0]?.slice(0, 80)
      expect(isTypeOnlyImport || isTypeDecl || isAmbientConst, `unexpected runtime statement: ${preview}`).toBe(true)
    }
  })

  it('exports no Config schema and no apply(ctx, config) plugin entry -- nothing here is a Cordis plugin export', () => {
    const hasConfigExport = typesSourceFile.statements.some(
      statement =>
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
        && statement.name.text === 'Config'
        && hasExportModifier(statement),
    )
    expect(hasConfigExport, 'exported Config type/interface').toBe(false)

    const hasApplyExport = typesSourceFile.statements.some((statement) => {
      if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) return statement.name?.text === 'apply'
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        return statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'apply')
      }
      return false
    })
    expect(hasApplyExport, 'exported apply plugin entry').toBe(false)
  })
})

describe('src/index.ts still re-exports every Contract-stage type (Provider stage added real runtime exports alongside it, see tests/gates.provider.spec.ts)', () => {
  it('keeps `export type * from \'./types.ts\'` as its first statement, so every Contract-stage type stays reachable unchanged', () => {
    const statement = indexSourceFile.statements[0]
    expect(statement, 'src/index.ts must have at least one statement').toBeDefined()
    expect(ts.isExportDeclaration(statement!), 'first statement must be an export declaration').toBe(true)
    const exportDecl = statement as ts.ExportDeclaration
    expect(exportDecl.isTypeOnly, 'export declaration must be `export type *`').toBe(true)
    expect(exportDecl.exportClause, 'a wildcard re-export has no export clause').toBeUndefined()
    expect(exportDecl.moduleSpecifier && ts.isStringLiteral(exportDecl.moduleSpecifier) && exportDecl.moduleSpecifier.text).toBe('./types.ts')
  })
})
