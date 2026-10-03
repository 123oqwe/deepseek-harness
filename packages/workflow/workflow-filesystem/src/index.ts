/**
 * Saved workflow definitions, loaded from the harness home at boot
 * (Epic P4-09 must[0], acceptance[0]; §12.48-A(2)).
 *
 * A "saved workflow" is a file. This plugin reads the definition files under
 * the harness home's `workflows` directory once, at mount, and registers each
 * one with the mounted engine — the same shape `dsh-skill-filesystem` uses to
 * turn a directory of Markdown files into skills.
 *
 * **Registering is not executing.** A definition's body reaches the engine as
 * a string and is stored as one; nothing here compiles, evaluates or imports
 * it, which is acceptance[0]'s claim and the reason this loader can read a
 * directory the model can write to.
 *
 * **Only a signed definition registers.** Beside each definition file sits
 * `<file>.sig.json`: the definition's digest, the fingerprint of the key that
 * signed it, and the signature over the digest. A definition is offered to the
 * engine only when that digest is the one computed from the bytes read and the
 * signature verifies against one of the deployment's offline-signed trust
 * anchors, held by the pinned Trust Kernel. Any other definition is refused
 * with the reason. The engine's registration check then recomputes the digest
 * and refuses a self-recursive definition.
 *
 * @module @deepseek-ai/dsh-workflow-filesystem
 */

import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { checkOfflineSignature } from '@deepseek-ai/dsh-plugin-provenance'
import { configuredTrustAnchors } from '@deepseek-ai/dsh-trust-kernel'
import type { TrustKernelTrustAnchor } from '@deepseek-ai/dsh-trust-kernel/types'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionDigest, DefinitionName, RegisteredDefinition, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'

/**
 * The one engine operation this loader needs.
 *
 * Declared structurally rather than imported from a concrete engine, because
 * registration is not on the `WorkflowEngine` seam: `RegisteredDefinition`
 * lives in `@deepseek-ai/dsh-workflow-registry`, which already depends on
 * `@deepseek-ai/dsh-workflow`, so declaring the method upstream would be a
 * project-reference cycle — measured, not assumed. A loader that imported one
 * engine instead would tie saved workflows to that implementation.
 */
export interface DefinitionSink {
  /**
   * Register one definition, throwing if it is refused.
   * @param definition - the definition to register.
   */
  registerDefinition(definition: RegisteredDefinition): void
}

/** The file extensions a saved definition may use. */
const DEFINITION_EXTENSIONS: readonly string[] = ['.js', '.mjs']

/** What follows a definition's file name to name the file holding its signature. */
const SIGNATURE_SUFFIX = '.sig.json'

/** Where a refusal sends an operator to learn how to sign a saved workflow. */
const SIGNING_GUIDE = 'see the @deepseek-ai/dsh-workflow-filesystem README for how to sign a saved workflow'

/**
 * Whether a mounted engine can accept registrations.
 * @param engine - the mounted `ctx.workflowEngine`.
 * @returns whether it carries {@link DefinitionSink}'s operation.
 */
function acceptsDefinitions(engine: unknown): engine is DefinitionSink {
  return typeof (engine as DefinitionSink | undefined)?.registerDefinition === 'function'
}

/**
 * One definition file, read but not interpreted.
 *
 * The NAME is the file's base name, not a field inside the body. A name read
 * out of the body would be a definition asserting its own identity, and the
 * registry keys version history by name — a body that renamed itself between
 * versions would split its own history in two.
 */
interface DefinitionFile {
  readonly name: string
  /** The file's own name, extension included. */
  readonly fileName: string
  readonly body: string
  /** The contents of `<fileName>.sig.json`, or `undefined` when there is none. */
  readonly signature: string | undefined
}

/**
 * Read a file that may be absent.
 * @param path - the file to read.
 * @returns its contents, or `undefined` when it cannot be read.
 */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // An absent signature file is the ordinary unsigned case, and an
    // unreadable one leaves the definition exactly as unverifiable; the
    // verification reports both as `unsigned`.
    return undefined
  }
}

/**
 * Read every definition file in a directory, with its signature file.
 *
 * A missing directory yields no definitions rather than an error: a
 * deployment that has saved no workflows is the ordinary case, not a
 * misconfiguration.
 * @param directory - the directory holding one file per definition.
 * @returns the files, by base name, in directory order.
 */
async function readDefinitions(directory: string): Promise<readonly DefinitionFile[]> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    // Missing, unreadable, or not a directory: all mean "no saved workflows
    // here", and a boot that failed on any of them would make an empty home a
    // startup error.
    return []
  }
  const files: DefinitionFile[] = []
  for (const entry of entries) {
    if (!DEFINITION_EXTENSIONS.includes(extname(entry))) continue
    const body = await readFile(join(directory, entry), 'utf8')
    const signature = await readIfPresent(join(directory, `${entry}${SIGNATURE_SUFFIX}`))
    files.push({ name: entry.slice(0, entry.length - extname(entry).length), fileName: entry, body, signature })
  }
  return files
}

/** Why a saved definition was refused before the engine saw it (P4-09 acceptance[0]). */
type SignatureRefusal = 'unsigned' | 'digest-mismatch' | 'no-trust-anchor' | 'signature-invalid'

/** A signature file's contents: the signed digest, the signing key's fingerprint, and the base64 signature over the digest. */
interface DefinitionSignature {
  readonly digest: string
  readonly publicKeyFingerprint: string
  readonly signature: string
}

/**
 * Read a signature file's contents.
 * @param text - the file's text.
 * @returns the signature, or `undefined` when the text is not one.
 */
function parseSignature(text: string): DefinitionSignature | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Text that is not JSON is not a signature; the caller refuses it as one
    // that does not verify.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const { digest, publicKeyFingerprint, signature } = value as Partial<Record<keyof DefinitionSignature, unknown>>
  return typeof digest === 'string' && typeof publicKeyFingerprint === 'string' && typeof signature === 'string'
    ? { digest, publicKeyFingerprint, signature }
    : undefined
}

/** An offline-signed anchor: one whose public key a saved definition's signature is checked against. */
type OfflineAnchor = Extract<TrustKernelTrustAnchor, { mode: 'offline-signed' }>

/**
 * Decide whether a definition's signature lets it register (P4-09 must[0],
 * acceptance[0]).
 * @param file - the definition and its signature file's contents.
 * @param digest - the digest computed from the bytes read.
 * @param anchors - the deployment's configured anchors, or `undefined` when no Trust Kernel is pinned.
 * @returns the owner of the anchor that verified the signature, or why the definition is refused.
 */
function verifyDefinitionSignature(
  file: DefinitionFile,
  digest: DefinitionDigest,
  anchors: readonly TrustKernelTrustAnchor[] | undefined,
):
  | { readonly verified: true; readonly owner: string }
  | { readonly verified: false; readonly reason: SignatureRefusal; readonly detail: string } {
  const signatureFile = `${file.fileName}${SIGNATURE_SUFFIX}`
  if (file.signature === undefined) return { verified: false, reason: 'unsigned', detail: `${signatureFile} is missing` }
  const signed = parseSignature(file.signature)
  if (signed === undefined) {
    return { verified: false, reason: 'signature-invalid', detail: `${signatureFile} does not hold { digest, publicKeyFingerprint, signature }` }
  }
  if (signed.digest !== digest) {
    return { verified: false, reason: 'digest-mismatch', detail: `the file hashes to ${digest} but ${signatureFile} names ${signed.digest}` }
  }
  if (anchors === undefined) {
    return { verified: false, reason: 'no-trust-anchor', detail: 'no Trust Kernel is pinned, so this deployment holds no trust anchor' }
  }
  const anchor = anchors.find((candidate): candidate is OfflineAnchor =>
    candidate.mode === 'offline-signed' && candidate.publicKeyFingerprint === signed.publicKeyFingerprint)
  if (anchor === undefined) {
    return { verified: false, reason: 'no-trust-anchor', detail: `no configured offline-signed trust anchor has the fingerprint ${signed.publicKeyFingerprint}` }
  }
  if (checkOfflineSignature(anchor, new TextEncoder().encode(signed.digest), Buffer.from(signed.signature, 'base64')) !== undefined) {
    return { verified: false, reason: 'signature-invalid', detail: `the signature in ${signatureFile} does not verify against the key of ${anchor.owner}` }
  }
  return { verified: true, owner: anchor.owner }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    savedWorkflows: SavedWorkflowLoader
  }
}

/**
 * Loads saved workflow definitions into the mounted engine at boot.
 *
 * Published as `ctx.savedWorkflows` so a composition can see what was loaded
 * and, in a test, what was refused. The refusals are kept rather than thrown
 * onward: one malformed file in a directory must not stop a harness from
 * starting, and an operator needs to know which file was rejected and why.
 */
export default class SavedWorkflowLoader extends Service {
  static inject = ['workflowEngine']

  /** Names registered from the definitions directory, in load order. */
  readonly loaded: string[] = []
  /** One entry per definition refused, by its signature check or by the engine, naming the file and the reason. */
  readonly refused: { readonly name: string; readonly reason: string }[] = []

  /**
   * @param ctx - the mounting context; the loader registers itself as `ctx.savedWorkflows`.
   */
  constructor(ctx: Context) {
    super(ctx, 'savedWorkflows')
  }

  /**
   * The directory saved definitions are read from.
   *
   * Derived from the harness home rather than configured: which directory a
   * deployment keeps its workflows in is not a choice a profile needs to vary,
   * and a second location would mean two answers to "where does this
   * definition come from" for one run.
   * @returns the absolute definitions directory.
   */
  get directory(): string {
    return dshHomePath('workflows')
  }

  /**
   * Read, verify and register every saved definition.
   *
   * Runs at mount through `Service.init`, so a composition that loads this
   * plugin has its saved workflows registered before the first turn — a run
   * that nests one must not depend on whether a load happened to finish first.
   * @returns once every definition file has been verified and, when it verified, offered to the engine.
   */
  async [Service.init](): Promise<void> {
    const engine = this.ctx.workflowEngine
    if (!acceptsDefinitions(engine)) {
      throw new Error(
        'workflow-filesystem: the mounted workflow engine does not accept definition registrations, so saved workflows would load into nothing',
      )
    }
    // The anchors a signature may verify against are the deployment's, held by
    // the pinned Trust Kernel; with no kernel pinned there are none, and every
    // saved definition is refused.
    const kernel = this.ctx.get('trustKernel')
    const anchors = kernel === undefined ? undefined : configuredTrustAnchors(kernel.signatureRoots)
    for (const file of await readDefinitions(this.directory)) {
      const digest = computeDefinitionDigest(file.body)
      const verdict = verifyDefinitionSignature(file, digest, anchors)
      if (!verdict.verified) {
        this.refuse(file.name, `${verdict.reason}: ${verdict.detail}; ${SIGNING_GUIDE}`)
        continue
      }
      const definition: RegisteredDefinition = {
        digest,
        name: brandString<DefinitionName>(file.name),
        version: 1,
        body: file.body,
        // The owner of the anchor whose key verified the signature.
        signer: brandString<SignerIdentity>(verdict.owner),
      }
      try {
        engine.registerDefinition(definition)
        this.loaded.push(file.name)
      } catch (error: unknown) {
        this.refuse(file.name, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * Record one refused definition, and log it so an operator sees it without a test harness.
   * @param name - the definition's name.
   * @param reason - why it was refused.
   */
  private refuse(name: string, reason: string): void {
    this.refused.push({ name, reason })
    this.ctx.logger.warn(`workflow-filesystem: saved workflow "${name}" was not loaded: ${reason}`)
  }
}
