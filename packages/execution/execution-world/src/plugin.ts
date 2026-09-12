/**
 * The mounted ExecutionWorld seam (Epic P3-01 must[2], acceptance[1]): the
 * provider registry, the request-to-spec resolution, and the per-session world
 * binding a dispatch path reads.
 *
 * **The registry is what keeps `local` out of the dispatch path.** must[2] says
 * the old `SandboxExecution` is the local provider's compat layer and is not
 * hardcoded in the Agent Loop; a dispatch path that named a provider would be
 * that hardcoding one layer out. It asks this service instead, and which
 * provider answers is the composition's own business.
 *
 * @module @deepseek-ai/dsh-execution-world/plugin
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import { selectWorldProvider } from './lifecycle.ts'
import type {
  WorldId,
  WorldProvider,
  WorldProviderId,
  WorldSpec,
  WorldSpecDigest,
} from './types.ts'

/**
 * What a dispatch path learns about the world its action will run in.
 *
 * Ids and a digest, never the {@link WorldHandle}: the handle is the authority
 * to operate the world (acceptance[2]), and a dispatch path needs to NAME the
 * world for the audit and the policy question, not to terminate it.
 */
export interface ExecutionWorldBinding {
  /** The world the session is bound to. */
  readonly world: WorldId
  /** The provider that minted it, so a provider swap is visible. */
  readonly provider: WorldProviderId
  /** Digest of the spec it was created from; what a policy compares confinement by. */
  readonly spec: WorldSpecDigest
}

/**
 * The confinement a deployment ASKS for, before any provider is consulted.
 *
 * Separate from the spec because the two answer different questions: this is
 * what the deployment wants, and a {@link WorldSpec} is what it wants stated in
 * all nine dimensions. Keeping the request partial is what lets a refusal
 * happen at all — a deployment that asks for `network: 'none'` gets a refusal
 * from a provider that cannot deliver it (acceptance[1]) rather than a quietly
 * weaker world.
 */
export interface WorldRequest {
  /** Network posture; `unrestricted` is what a local host actually is. */
  readonly network?: WorldSpec['network']['posture']
  /** Whether the world may start processes. */
  readonly spawn?: boolean
  /** IPC posture. */
  readonly ipc?: WorldSpec['ipc']['posture']
  /** How secrets reach the world. */
  readonly secrets?: WorldSpec['secrets']['posture']
  /** Wall-clock ceiling, in milliseconds; absent means the world outlives no clock. */
  readonly maxWallClockMs?: number
}

/**
 * What the file-effect boundary resolved for this session, named structurally
 * because `@deepseek-ai/dsh-sandbox-policy` sits above this package.
 */
interface SandboxPolicyPort {
  /**
   * Resolve the file-effect policy for one session.
   * @param input - the session whose policy is asked for.
   * @returns the resolved sandbox mode and workspace root.
   */
  resolve(input: { session: unknown }): { mode: string; workspaceRoot: string }
}

/**
 * The file-effect dimension for one resolved sandbox mode.
 *
 * **The two vocabularies differ by one name and the translation is explicit.**
 * `dsh-sandbox` calls its widest mode `danger-full-access`; a `WorldSpec` calls
 * the same thing `full-access`, because a spec describes confinement rather than
 * warning an operator about it. Passing the sandbox's spelling straight through
 * produced a spec with an effect no dimension rule recognises: the local
 * provider's per-dimension check saw a value it had no case for, answered
 * "satisfiable", and `create` then refused the world — so a whole profile bound
 * no world and the failure looked like an honest refusal. An unknown mode is
 * refused here instead, where the vocabulary is.
 * @param mode - the resolved sandbox mode.
 * @param workspaceRoot - the root a `workspace-write` world is confined to.
 * @returns the filesystem dimension, or `undefined` for a mode this mapping does not know.
 */
export function filesystemForSandboxMode(
  mode: string,
  workspaceRoot: string,
): WorldSpec['filesystem'] | undefined {
  if (mode === 'read-only') return { effect: 'read-only' }
  if (mode === 'workspace-write') return { effect: 'workspace-write', workspaceRoot }
  if (mode === 'danger-full-access') return { effect: 'full-access' }
  return undefined
}

/** The agent shape this service reads, kept structural for the same reason. */
interface BindableAgent {
  readonly id: string
  readonly session: unknown
}

/**
 * State the nine dimensions from a partial request and the resolved file-effect
 * policy (the `dsh-shell` request/spec split).
 *
 * Every default is stated here rather than at a point of use, so a deployment
 * reading this function learns exactly what it gets by saying nothing. The
 * defaults describe what a local host IS — unrestricted network and IPC,
 * spawning allowed, the standard device sinks, inherited secrets, no resource
 * ceiling — because a request that understates the host would produce a world
 * whose spec claims a confinement nothing enforces.
 * @param request - the deployment's partial ask.
 * @param filesystem - the file-effect boundary the composition already resolved.
 * @param tenant - the tenant the world belongs to.
 * @returns the complete spec to select a provider with.
 */
export function resolveWorldSpec(
  request: WorldRequest,
  filesystem: WorldSpec['filesystem'],
  tenant: TenantId,
): WorldSpec {
  return {
    filesystem,
    network: { posture: request.network ?? 'unrestricted' },
    process: { spawn: request.spawn ?? true },
    ipc: { posture: request.ipc ?? 'unrestricted' },
    devices: { allowed: ['/dev/null'] },
    secrets: { posture: request.secrets ?? 'inherited' },
    resources: {},
    lifetime: {
      detached: false,
      ...request.maxWallClockMs === undefined ? {} : { maxWallClockMs: request.maxWallClockMs },
    },
    tenant,
  }
}

/** Digest a spec by its canonical JSON, so two equal specs digest equally. */
export function digestWorldSpec(spec: WorldSpec): WorldSpecDigest {
  return brandString<WorldSpecDigest>(createHash('sha256').update(JSON.stringify(spec)).digest('hex'))
}

/** What a profile row configures on the world registry. */
export interface Config {
  /** The tenant every world this host mints belongs to. */
  tenant: string
  /** The confinement this deployment asks for, before any provider is consulted. */
  request: WorldRequest
}

/**
 * The registry of world providers, and the session-to-world binding.
 *
 * Mounting this service creates no world. A world is created at the first
 * dispatch that asks for one, and only when a registered provider satisfies the
 * resolved spec: a composition that registers no provider, or whose providers
 * all refuse, keeps answering `undefined`, which the dispatch path reads as the
 * fail-closed `absent` policy fact.
 */
export default class ExecutionWorldService extends Service<Config> {
  /**
   * Runtime configuration, validated at mount from the profile's row.
   *
   * A STATIC member rather than a module-level `export const Config`: a module
   * doing both leaves the Loader discarding a namespace
   * (docs/postmortem/0001-acp-default-export-drops-inject.md).
   */
  static Config = z.object({
    tenant: z.string().default('local-host'),
    request: z.object({
      network: z.union([z.const('none'), z.const('allowlist'), z.const('unrestricted')]).default('unrestricted'),
      spawn: z.boolean().default(true),
      ipc: z.union([z.const('none'), z.const('parent-only'), z.const('unrestricted')]).default('unrestricted'),
      secrets: z.union([z.const('none'), z.const('broker-only'), z.const('inherited')]).default('inherited'),
    }).default({
      network: 'unrestricted',
      spawn: true,
      ipc: 'unrestricted',
      secrets: 'inherited',
    }),
  }) as z<Config>

  private readonly providers: WorldProvider[] = []
  private readonly bound = new Map<string, ExecutionWorldBinding>()
  private readonly request: WorldRequest
  private readonly tenant: TenantId

  constructor(ctx: Context, config: Config) {
    super(ctx, 'executionWorlds')
    this.tenant = brandString<TenantId>(config.tenant)
    this.request = config.request
  }

  /**
   * Register one provider, in the deployment's own preference order.
   *
   * A registration is an effect, so unmounting the registering plugin removes
   * the provider rather than leaving a registry that outlives it.
   * @param provider - the provider to offer to selection.
   * @returns the disposer.
   */
  register(provider: WorldProvider): () => void {
    return this.ctx.effect(() => {
      this.providers.push(provider)
      return () => {
        const at = this.providers.indexOf(provider)
        if (at >= 0) this.providers.splice(at, 1)
      }
    })
  }

  /**
   * The world this agent's session runs in, creating it on first ask.
   *
   * Returns `undefined` rather than a weaker world when no provider satisfies
   * the spec: acceptance[1] forbids degradation, and the caller's fail-closed
   * reading of `undefined` is what makes the refusal reach the policy question.
   * @param agent - the dispatching agent, whose session the world is bound to.
   * @returns the binding, or `undefined` when this composition can offer none.
   */
  async bindingFor(agent: BindableAgent): Promise<ExecutionWorldBinding | undefined> {
    const existing = this.bound.get(agent.id)
    if (existing !== undefined) return existing
    const sandbox = this.ctx.get('sandboxPolicy') as SandboxPolicyPort | undefined
    if (sandbox === undefined) return undefined
    const { mode, workspaceRoot } = sandbox.resolve({ session: agent.session })
    const filesystem = filesystemForSandboxMode(mode, workspaceRoot)
    if (filesystem === undefined) return undefined
    const spec = resolveWorldSpec(this.request, filesystem, this.tenant)
    const selection = selectWorldProvider(spec, this.providers)
    if (selection.outcome === 'refused') return undefined
    const handle = await selection.provider.create(spec).catch(() => undefined)
    if (handle === undefined) return undefined
    const binding: ExecutionWorldBinding = {
      world: handle.id,
      provider: handle.provider,
      spec: handle.spec,
    }
    this.bound.set(agent.id, binding)
    return binding
  }
}

/** Mint a world id; exported so a composition can pin it in a test. */
export function nextWorldId(): WorldId {
  return brandString<WorldId>(randomUUID())
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The ExecutionWorld provider registry and session binding (P3-01). */
    executionWorlds: ExecutionWorldService
  }
}
