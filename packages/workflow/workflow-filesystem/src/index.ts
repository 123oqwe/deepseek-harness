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
 * directory the model can write to. What protects a run is the engine's
 * registration check, not this plugin's caution: the digest is recomputed from
 * the body, and a mismatch or a self-recursive definition is refused there.
 *
 * @module @deepseek-ai/dsh-workflow-filesystem
 */

import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, RegisteredDefinition, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'

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
  readonly body: string
}

/**
 * Read every definition file in a directory.
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
    files.push({ name: entry.slice(0, entry.length - extname(entry).length), body })
  }
  return files
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
  /** One entry per definition the engine refused, naming the file and the reason. */
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
   * Read and register every saved definition.
   *
   * Runs at mount through `Service.init`, so a composition that loads this
   * plugin has its saved workflows registered before the first turn — a run
   * that nests one must not depend on whether a load happened to finish first.
   * @returns once every definition file has been offered to the engine.
   */
  async [Service.init](): Promise<void> {
    const engine = this.ctx.workflowEngine
    if (!acceptsDefinitions(engine)) {
      throw new Error(
        'workflow-filesystem: the mounted workflow engine does not accept definition registrations, so saved workflows would load into nothing',
      )
    }
    for (const file of await readDefinitions(this.directory)) {
      const definition: RegisteredDefinition = {
        digest: computeDefinitionDigest(file.body),
        name: brandString<DefinitionName>(file.name),
        version: 1,
        body: file.body,
        // The loader is the signer it can honestly claim: this build has no
        // signature root, and recording a stronger provenance than the one
        // that exists would make an unverified file look attested.
        signer: brandString<SignerIdentity>('workflow-filesystem'),
      }
      try {
        engine.registerDefinition(definition)
        this.loaded.push(file.name)
      } catch (error: unknown) {
        this.refused.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
