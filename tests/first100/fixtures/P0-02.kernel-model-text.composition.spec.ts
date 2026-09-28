/**
 * B-682, the model-visible half of P0-02 acceptance[1] (BLOCKED-306 condition
 * 3; delegate ruling, gate3 2026-09-27T16:13:16Z): the Trust Kernel writes no
 * text that a model request carries.
 *
 * The ruling fixes what counts: model-visible text is a string the kernel
 * module writes that the product puts into a model request by design, in the
 * system prompt, a tool schema, a message or a tool result. The searched
 * strings are every string literal of the kernel's runtime module
 * (`packages/kernel/trust-kernel/src/index.ts`), read with the walk the
 * kernel's own runtime-surface spec checks. Module specifiers are left out:
 * the loader resolves them and they are never values. `types.ts` declares
 * types only, which compile to nothing the running kernel could write.
 *
 * `./loader/p0-02-kernel-model-text/driver.ts` boots the SHIPPED headless
 * profile in-process with the kernel pinned as the launcher pins it, and makes
 * one dispatch the kernel allows and one it denies. The control run puts the
 * longest kernel literal, after a marker, into the task, a tool description
 * and a tool result, and the same search must find it in each of those places.
 *
 * `apps/cli/tests/trust-kernel-model-input.spec.ts` reads a real launch with
 * one permitted call for the literals that contain whitespace; this file adds
 * the denied dispatch, every literal, the control and the static case. Green
 * today: it is observation evidence, not a red first.
 * @module tests/first100/fixtures/P0-02.kernel-model-text.composition.spec
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { KERNEL_SRC_DIR, readRuntimeModuleSyntax } from '../../../packages/kernel/trust-kernel/tests/fixtures/runtime-surface.ts'
import {
  CONTROL_MARKER,
  DENIED_CALL_ID,
  type KernelTextReport,
  PERMITTED_CALL_ID,
  type RecordedRequest,
  type RunKind,
} from './loader/p0-02-kernel-model-text/shared.ts'

const driver = fileURLToPath(new URL('./loader/p0-02-kernel-model-text/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-11-policy-deny/deny.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The kernel's type module, which declares the `TrustKernel` interface. */
const KERNEL_TYPES_MODULE = resolve(KERNEL_SRC_DIR, 'types.ts')

/** Compiler options for reading `types.ts` alone, as the kernel's runtime-surface fixture reads `index.ts`. */
const PROBE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
}

/** Where in a model request a string reaches the model. */
type Channel = 'system' | 'messages' | 'tool-results' | 'tools'

/** One place a searched string was found. */
interface Hit {
  readonly literal: string
  /** The request's index among the requests the scripted adapter received. */
  readonly request: number
  readonly channel: Channel
  /** Whether the string it was found in holds the control's marker directly before it. */
  readonly marked: boolean
  readonly excerpt: string
}

/**
 * Run the driver once.
 * @param kind - the run.
 * @param literal - the kernel literal the control run injects.
 * @returns the driver's report.
 */
async function run(kind: RunKind, literal?: string): Promise<KernelTextReport> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P0-02 kernel model text: ${kind}`,
    tempDirPrefix: `p0-02-kernel-text-${kind}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: literal === undefined ? [overlay, kind] : [overlay, kind, literal],
    tsconfigPath: repoTsconfig,
  })
  const json = /P0-02-KERNEL-TEXT (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${kind} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as KernelTextReport
}

/**
 * Every string anywhere inside a parsed JSON value.
 * @param value - the value.
 * @returns its string leaves.
 */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves)
  return []
}

/**
 * Whether a content block is a tool result.
 * @param block - the block.
 * @returns true for a `tool-result` block.
 */
function isToolResult(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as { readonly type?: unknown }).type === 'tool-result'
}

/**
 * A recorded request's strings, by the place they reach the model.
 * @param request - the request.
 * @returns the string leaves of the system prompt, of the other messages' blocks that are not tool results, of the tool results, and of the tool schemas.
 */
function channelsOf(request: RecordedRequest): Record<Channel, string[]> {
  const blocks = (content: unknown): unknown[] => Array.isArray(content) ? content : []
  const system = request.messages.filter(message => message.role === 'system')
  const others = request.messages.filter(message => message.role !== 'system')
  return {
    'system': [...request.system === null ? [] : [request.system], ...system.flatMap(message => stringLeaves(message.content))],
    'messages': others.flatMap(message => blocks(message.content).filter(block => !isToolResult(block)).flatMap(stringLeaves)),
    'tool-results': request.messages.flatMap(message => blocks(message.content).filter(isToolResult).flatMap(stringLeaves)),
    'tools': stringLeaves(request.tools),
  }
}

/**
 * Every place any of the searched strings occurs in the recorded requests.
 * @param requests - the recorded requests.
 * @param literals - the strings to search for, each verbatim.
 * @returns one hit per literal, request, channel and string it occurs in.
 */
function hitsOf(requests: readonly RecordedRequest[], literals: readonly string[]): Hit[] {
  return requests.flatMap((request, index) => Object.entries(channelsOf(request)).flatMap(([channel, texts]) =>
    texts.flatMap(text => literals.filter(literal => text.includes(literal)).map(literal => ({
      literal,
      request: index,
      channel: channel as Channel,
      marked: text.includes(`${CONTROL_MARKER}${literal}`),
      excerpt: text.slice(0, 200),
    })))))
}

/**
 * The distinct string literals of the kernel's runtime module.
 * @returns them, in source order.
 */
function kernelLiterals(): string[] {
  return [...new Set(readRuntimeModuleSyntax().literals)]
}

describe('P0-02 acceptance[1] on the shipped headless composition with the Trust Kernel pinned: the kernel writes no model-visible text (B-682)', () => {
  it('acceptance[1]: across a dispatch the kernel allows and one it denies, no string literal of the kernel runtime module reaches any model request', async () => {
    // A template with substitutions computes its text, which no literal list covers.
    expect(readRuntimeModuleSyntax().templateExpressions).toBe(0)
    const literals = kernelLiterals()
    expect(literals.length).toBeGreaterThan(0)

    const report = await run('observe')
    const shown = JSON.stringify({ ...report, requests: report.requests.length })
    expect(report.kernelPinned, shown).toBe(true)
    // The kernel decided both dispatches: it allowed the first, whose body ran, and denied the second, whose body did not.
    const permitted = report.decisions.filter(decision => decision.actionId === PERMITTED_CALL_ID).map(decision => decision.effect)
    const denied = report.decisions.filter(decision => decision.actionId === DENIED_CALL_ID).map(decision => decision.effect)
    expect(permitted.length > 0 && permitted.every(effect => effect === 'permit'), shown).toBe(true)
    expect(denied.length > 0 && denied.every(effect => effect === 'deny'), shown).toBe(true)
    expect(report.ran, shown).toEqual([PERMITTED_CALL_ID])
    expect(report.results.map(result => [result.callId, result.isError]), shown).toEqual([[PERMITTED_CALL_ID, false], [DENIED_CALL_ID, true]])
    // The refusal reached the model: a later request carries it as a tool result.
    const refusal = report.results.find(result => result.callId === DENIED_CALL_ID)?.text ?? ''
    expect(refusal, shown).not.toBe('')
    expect(report.requests.some(request => channelsOf(request)['tool-results'].some(text => text.includes(refusal))), shown).toBe(true)

    expect(hitsOf(report.requests, literals)).toEqual([])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: the longest kernel literal, placed after a marker in the task, a tool description and a tool result, is found in each of those places', async () => {
    const longest = kernelLiterals().reduce((kept, literal) => literal.length > kept.length ? literal : kept, '')
    expect(longest).not.toBe('')

    const report = await run('control', longest)
    const hits = hitsOf(report.requests, [longest])
    expect([...new Set(hits.map(hit => hit.channel))], JSON.stringify(hits)).toEqual(expect.arrayContaining(['messages', 'tool-results', 'tools']))
    expect(hits.every(hit => hit.marked), JSON.stringify(hits)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[1]: no call signature reachable from the TrustKernel type returns a type that admits an arbitrary string', () => {
    const program = ts.createProgram([KERNEL_TYPES_MODULE], PROBE_OPTIONS)
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(KERNEL_TYPES_MODULE)
    if (source === undefined) throw new Error('the probe program did not load src/types.ts')
    const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'TrustKernel')
    if (declaration === undefined) throw new Error('src/types.ts declares no TrustKernel interface')
    const symbol = checker.getSymbolAtLocation(declaration.name)
    if (symbol === undefined) throw new Error('the TrustKernel interface has no symbol')

    // Members are followed only into types `types.ts` declares, so the
    // library's own members (a function's `toString`, say) are not the kernel's.
    const signatures: { readonly path: string, readonly returns: string, readonly admitsString: boolean }[] = []
    const visited = new Set<ts.Type>()
    const visit = (type: ts.Type, path: string): void => {
      if (visited.has(type)) return
      visited.add(type)
      for (const signature of type.getCallSignatures()) {
        const returns = signature.getReturnType()
        signatures.push({ path, returns: checker.typeToString(returns), admitsString: checker.isTypeAssignableTo(checker.getStringType(), returns) })
      }
      for (const property of type.getProperties()) {
        const declaredHere = (property.declarations ?? []).some(node => node.getSourceFile() === source)
        if (declaredHere) visit(checker.getTypeOfSymbol(property), `${path}.${property.name}`)
      }
    }
    visit(checker.getDeclaredTypeOfSymbol(symbol), 'TrustKernel')

    expect(signatures.map(signature => signature.path), JSON.stringify(signatures)).toEqual(expect.arrayContaining([
      'TrustKernel.policyEnforcement',
      'TrustKernel.auditAppend',
      'TrustKernel.sandboxAttestationVerifier',
    ]))
    expect(signatures.filter(signature => signature.admitsString), JSON.stringify(signatures)).toEqual([])
  })
})
