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
 * A hit is let through only by {@link ALLOWED} (delegate ruling, gate3
 * 2026-09-28T02:02:29Z): text outside the kernel that happens to contain a
 * kernel literal, such as the shipped bash tool's description with the word
 * `deny`. Each entry proves its provenance on every run: its sentence is in
 * its source file verbatim, the file does not import the kernel, and the hit's
 * literal falls inside that sentence. Every other hit stays red, and the
 * control is not filtered.
 *
 * `apps/cli/tests/trust-kernel-model-input.spec.ts` reads a real launch with
 * one permitted call for the literals that contain whitespace; this file adds
 * the denied dispatch, every literal, the control and the static case. Green
 * today: it is observation evidence, not a red first.
 * @module tests/first100/fixtures/P0-02.kernel-model-text.composition.spec
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** One passage of model-visible text outside the kernel that contains a kernel literal. */
interface AllowedText {
  readonly literal: string
  /** The non-kernel source file that writes the sentence, from the repository root. */
  readonly file: string
  /** Where the sentence is written, for the reader. */
  readonly line: number
  /** The sentence, verbatim, with the literal inside it. */
  readonly sentence: string
}

/**
 * The passages a hit may fall inside (delegate ruling, gate3 2026-09-28T02:02:29Z).
 * The shipped bash and pwsh tools describe a confining sandbox with the word
 * `deny`, which is also a kernel literal (`index.ts`'s default verdict).
 */
const ALLOWED: readonly AllowedText[] = [
  { literal: 'deny', file: 'packages/shell/tool-bash/src/index.ts', line: 84, sentence: 'Attempting a command the sandbox may deny is safe and expected' },
  { literal: 'deny', file: 'packages/shell/tool-pwsh/src/index.ts', line: 133, sentence: 'Attempting a command the sandbox may deny is safe and expected' },
]

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
  /** Whether every occurrence of the literal in the string falls inside a sentence the allowlist passed in names. */
  readonly allowed: boolean
  /** The text around the first occurrence, up to 160 characters on each side. */
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
 * The text around the first occurrence of a string.
 * @param text - the text.
 * @param found - a string that occurs in `text`.
 * @returns the occurrence with up to 160 characters on each side.
 */
function excerptAround(text: string, found: string): string {
  const at = text.indexOf(found)
  return text.slice(Math.max(0, at - 160), at + found.length + 160)
}

/**
 * Every start position of a string in a text.
 * @param text - the text.
 * @param found - the string.
 * @returns the positions, in order.
 */
function positionsOf(text: string, found: string): number[] {
  const positions: number[] = []
  for (let at = text.indexOf(found); at !== -1; at = text.indexOf(found, at + 1)) positions.push(at)
  return positions
}

/**
 * Whether every occurrence of a literal in a text falls inside an occurrence
 * of one of the sentences an allowlist names for that literal.
 * @param text - the text the literal was found in.
 * @param literal - the literal.
 * @param allowed - the allowlist.
 * @returns true when no occurrence lies outside every such sentence.
 */
function insideAllowedSentences(text: string, literal: string, allowed: readonly AllowedText[]): boolean {
  const spans = allowed
    .filter(entry => entry.literal === literal)
    .flatMap(entry => positionsOf(text, entry.sentence).map(start => ({ start, end: start + entry.sentence.length })))
  return positionsOf(text, literal).every(at => spans.some(span => span.start <= at && at + literal.length <= span.end))
}

/**
 * Every place any of the searched strings occurs in the recorded requests.
 * @param requests - the recorded requests.
 * @param literals - the strings to search for, each verbatim.
 * @param allowed - the passages a hit may fall inside; the control passes none.
 * @returns one hit per literal, request, channel and string it occurs in.
 */
function hitsOf(requests: readonly RecordedRequest[], literals: readonly string[], allowed: readonly AllowedText[]): Hit[] {
  return requests.flatMap((request, index) => Object.entries(channelsOf(request)).flatMap(([channel, texts]) =>
    texts.flatMap(text => literals.filter(literal => text.includes(literal)).map(literal => ({
      literal,
      request: index,
      channel: channel as Channel,
      marked: text.includes(`${CONTROL_MARKER}${literal}`),
      allowed: insideAllowedSentences(text, literal, allowed),
      excerpt: excerptAround(text, literal),
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
  it('acceptance[1]: across a dispatch the kernel allows and one it denies, no model request carries a string literal of the kernel runtime module except inside a proven non-kernel sentence', async () => {
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

    // Each allowlist entry proves its provenance: the sentence is in its file
    // verbatim, holds the literal, and the file does not import the kernel.
    for (const entry of ALLOWED) {
      const source = readFileSync(join(repoRoot, entry.file), 'utf8')
      expect(source.includes(entry.sentence), `${entry.file}:${String(entry.line)} no longer writes «${entry.sentence}»`).toBe(true)
      expect(entry.sentence.includes(entry.literal), `${entry.file}:${String(entry.line)}`).toBe(true)
      expect(source.includes('@deepseek-ai/dsh-trust-kernel'), `${entry.file} imports the Trust Kernel`).toBe(false)
    }
    // Each hit that is not inside an allowlisted sentence, in full: vitest's diff truncates the objects.
    const unexplained = hitsOf(report.requests, literals, ALLOWED).filter(hit => !hit.allowed)
    expect(unexplained, JSON.stringify(unexplained)).toEqual([])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: the longest kernel literal, placed after a marker in the task, a tool description and a tool result, is found in each of those places', async () => {
    const longest = kernelLiterals().reduce((kept, literal) => literal.length > kept.length ? literal : kept, '')
    expect(longest).not.toBe('')

    const report = await run('control', longest)
    const hits = hitsOf(report.requests, [longest], [])
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
