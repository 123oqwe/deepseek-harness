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
import type { PolicySet } from './policy.ts'
import type {
  WorldId,
  WorldProvider,
  WorldProviderId,
  WorldResourcesSpec,
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
  /**
   * The resource ceilings this world runs under (P3-10 R3): what a caller asks
   * for when it needs to know "how much may this agent's world use", without
   * holding a {@link WorldHandle} and without reading a provider's private
   * table.
   *
   * Taken from the spec `bindingFor` already resolved, not read back from the
   * provider: the provider was SELECTED for that spec, and a provider that
   * could not satisfy it is refused rather than allowed to weaken it
   * (acceptance[1]), so the resolved ceilings are the world's ceilings.
   *
   * `{}` means this deployment asked for none — the state of every world
   * before a request could carry them.
   */
  readonly resources: WorldResourcesSpec
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
  /**
   * The resource ceilings this deployment asks its worlds to run under
   * (P3-10 must[0]'s cpu, memory and disk dimensions).
   *
   * **Absent means no ceiling was asked for, which is what every world got
   * before this field existed.** `resolveWorldSpec` wrote `resources: {}`
   * unconditionally, so `WorldSpec.resources` was a declared shape with no way
   * for a deployment to fill it: the three fields existed, the request did
   * not carry them, and the config schema did not validate them. A binding
   * reporting ceilings would have reported `{}` for every world.
   *
   * The keys are {@link WorldResourcesSpec}'s own, so a reader comparing a
   * request against a spec compares one vocabulary with itself.
   */
  readonly resources?: WorldResourcesSpec
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
    resources: request.resources ?? {},
    lifetime: {
      detached: false,
      ...request.maxWallClockMs === undefined ? {} : { maxWallClockMs: request.maxWallClockMs },
    },
    tenant,
  }
}

/**
 * Digest a spec by its canonical JSON, so two equal specs digest equally.
 * @param spec - the complete spec to digest.
 * @returns the spec's digest, which a policy compares confinement by.
 */
export function digestWorldSpec(spec: WorldSpec): WorldSpecDigest {
  return brandString<WorldSpecDigest>(createHash('sha256').update(JSON.stringify(spec)).digest('hex'))
}

/** What a profile row configures on the world registry. */
export interface Config {
  /** The tenant every world this host mints belongs to. */
  tenant: string
  /** The confinement this deployment asks for, before any provider is consulted. */
  request: WorldRequest
  /**
   * The rules a provider must satisfy before it is chosen (P3-02).
   *
   * Absent means what it meant before this field existed: selection asks each
   * provider whether it can build the requested world and nothing more. There
   * is NO default policy, because a default here would be a deployment's
   * security posture chosen by this file -- and because the rules are closed,
   * a policy naming one dimension refuses every provider that does not declare
   * it, which is not a change anyone should get without writing it.
   *
   * **On the shipped product today, setting ANY policy refuses every world.**
   * A legal policy has to cover all seven governable dimensions -- an unnamed
   * one refuses as `unknown-dimension` (must[2]) -- and the only provider this
   * repository ships declares `filesystem` alone, so the other six refuse as
   * `unsupported-by-provider` (must[3]). That is the honest consequence of
   * both rules rather than a defect in either, but it makes this field, until
   * a provider that enforces more dimensions exists, a switch whose only
   * settings are "no policy" and "no worlds". Stated here because the field
   * reads as ordinary configuration and behaves as neither half of it does
   * alone.
   */
  policy?: PolicySet
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
      // Validated here and nowhere else, because a ceiling a deployment can
      // state is exactly the kind of value AGENTS.md puts in a `Config` field
      // rather than in a constant. Whole positive counts only: a fractional or
      // zero ceiling is a misconfiguration, and it must fail at load rather
      // than reach a provider that would have to guess what it meant.
      //
      // No defaults. An absent ceiling is "this deployment asked for none",
      // which is what every world had before these fields existed, and a
      // default would silently impose a limit nobody wrote.
      maxWallClockMs: z.number().step(1).min(1),
      resources: z.object({
        cpuMillicores: z.number().step(1).min(1),
        memoryBytes: z.number().step(1).min(1),
        diskBytes: z.number().step(1).min(1),
      }),
    // NO `.default()` on this object, and its absence is load-bearing twice
    // over. Schemastery types `default(value: T)` against the object's OUTPUT
    // type, in which EVERY key is required regardless of its own default
    // (`ObjectT`, `vendor/schemastery/src/index.ts:38`, `default` at `:167`).
    // A default listing four of six keys is therefore a type error the moment
    // a fifth key exists, and the two ceilings above deliberately have no
    // default of their own, so there is no value to list for them.
    //
    // It also changed nothing: an object schema builds its result from its
    // CHILDREN's defaults, so `undefined`, `{}`, `{ request: {} }` and a
    // request carrying only `resources` all resolve identically with or
    // without it -- measured, not assumed. An absent ceiling stays absent
    // rather than becoming an explicit `undefined`, which is what
    // `exactOptionalPropertyTypes` and `WorldRequest`'s optional fields want.
    }),
    // WRAPPED IN A UNION, and that is the whole reason this field is safe.
    // Schemastery gives every `object`/`dict` an implicit `meta.default = {}`
    // and every `array` an implicit `[]` (`vendor/schemastery/src/index.ts:852-855`),
    // and `resolve` substitutes a schema's default for an absent value
    // (`:474-483`). A bare `z.object` here would therefore turn "this
    // deployment wrote no policy" into a policy governing all seven
    // dimensions with every allowlist empty -- and an empty allowlist REFUSES
    // EVERYTHING (`policy-solver.ts`, rule 2), so all six shipped bundles
    // would stop creating worlds. Measured, not reasoned: the nested form
    // resolves `{}` to `{"policy":{"network":{"allowedPostures":[]}}}` while
    // this union form leaves the key absent.
    //
    // A union carries no implicit default because that branch fires for
    // `object`, `dict`, `array`, `tuple` and `bitset` only, so an absent
    // policy stays absent and a written one is validated by the member
    // schema exactly as before.
    //
    // `request.resources` does not need this: its empty resolution is `{}`,
    // an object with no ceilings, which is what "this deployment set no
    // ceiling" already meant. The difference is in the VALUE DOMAIN, not the
    // schema -- for a policy the empty value is the strictest possible rule,
    // for a ceiling it is the absence of one.
    policy: z.union([z.object({
      filesystem: z.union([z.object({
        allowedEffects: z.array(z.union([z.const('none'), z.const('read-only'), z.const('workspace-write'), z.const('full-access')])),
        allowedRights: z.array(z.string()),
      })]),
      network: z.union([z.object({
        allowedPostures: z.array(z.union([z.const('none'), z.const('allowlist'), z.const('unrestricted')])),
      })]),
      process: z.union([z.object({
        allowSpawn: z.boolean(),
        maxProcessesCeiling: z.number().step(1).min(1),
      })]),
      ipc: z.union([z.object({
        allowedPostures: z.array(z.union([z.const('none'), z.const('parent-only'), z.const('unrestricted')])),
      })]),
      devices: z.object({ allowedDevices: z.array(z.string()) }),
      secrets: z.union([z.object({
        allowedPostures: z.array(z.union([z.const('none'), z.const('broker-only'), z.const('inherited')])),
      })]),
      resources: z.union([z.object({
        cpuMillicoresCeiling: z.number().step(1).min(1),
        memoryBytesCeiling: z.number().step(1).min(1),
        diskBytesCeiling: z.number().step(1).min(1),
      })]),
    })]),
  }) as z<Config>

  private readonly providers: WorldProvider[] = []
  private readonly bound = new Map<string, ExecutionWorldBinding>()
  private readonly request: WorldRequest
  private readonly tenant: TenantId
  /** The deployment's rules, or `undefined` when it stated none. */
  private readonly policy: PolicySet | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'executionWorlds')
    this.tenant = brandString<TenantId>(config.tenant)
    this.request = config.request
    this.policy = config.policy
  }

  /**
   * Register one provider, in the deployment's own preference order.
   *
   * A registration is an effect, so unmounting the registering plugin removes
   * the provider rather than leaving a registry that outlives it.
   *
   * The disposer is `@deepseek-ai/cordis`' own `Disposable<Promise<void>>`, returned
   * unchanged, and the declared return type says so rather than narrowing it to
   * `() => void`. Narrowing would be a lie the linter catches
   * (`no-misused-promises`) and would also cost a caller the ability to await
   * teardown; `AgentRegistry.register` keeps the narrow type and suppresses the
   * rule because returning the disposer unchanged preserves its identity for
   * its own callers, and nothing here depends on that.
   * @param provider - the provider to offer to selection.
   * @returns the disposer, which settles once the provider is removed.
   */
  register(provider: WorldProvider): () => Promise<void> {
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
    const selection = selectWorldProvider(spec, this.providers, this.policy)
    if (selection.outcome === 'refused') return undefined
    const handle = await selection.provider.create(spec).catch(() => undefined)
    if (handle === undefined) return undefined
    const binding: ExecutionWorldBinding = {
      world: handle.id,
      provider: handle.provider,
      spec: handle.spec,
      resources: spec.resources,
    }
    this.bound.set(agent.id, binding)
    return binding
  }
}

/**
 * Mint a world id; exported so a composition can pin it in a test.
 * @returns a fresh world id, unique to this minting.
 */
export function nextWorldId(): WorldId {
  return brandString<WorldId>(randomUUID())
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The ExecutionWorld provider registry and session binding (P3-01). */
    executionWorlds: ExecutionWorldService
  }
}
