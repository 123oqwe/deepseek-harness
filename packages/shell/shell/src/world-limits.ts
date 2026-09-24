/**
 * The spawn ceilings of the world a dispatching agent's session is bound to
 * (P3-10 R4). The shell tools resolve them once per call, at the same point
 * they resolve the sandbox policy, and carry them to the spawn as data.
 * @module @deepseek-ai/dsh-shell/world-limits
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessLimitDimension, SubprocessLimits } from '@deepseek-ai/dsh-subprocess'

/**
 * The binding fields this reader needs, named structurally so the shell tools
 * need not depend on `@deepseek-ai/dsh-execution-world`; the same reason
 * `readExecutionWorldFact` in `@deepseek-ai/dsh-tools` names its port.
 */
interface WorldCeilingsBinding {
  readonly resources: {
    readonly cpuMillicores?: number
    readonly memoryBytes?: number
    readonly diskBytes?: number
  }
  readonly maxProcesses?: number
}

/** A ceiling a deployment states for its worlds, by the name its request uses. */
export type WorldCeilingName = 'cpuMillicores' | 'memoryBytes' | 'diskBytes' | 'maxProcesses'

/** The world registry, in the two methods this reader calls. */
interface WorldCeilingsPort {
  bindingFor(agent: { readonly id: string; readonly session: unknown }): Promise<WorldCeilingsBinding | undefined>
  requestedCeilings(): Readonly<Partial<Record<WorldCeilingName, number>>>
}

/** The session's sandbox mode, the one fact this reader needs from the policy service. */
interface SandboxModePort {
  resolve(input: { readonly session: unknown }): { readonly mode: string }
}

/** Why no world bound for a call could hold the ceilings its deployment states. */
export type WorldCeilingsRefusal =
  /** The session runs in `danger-full-access`, where no world is bound. */
  | { readonly kind: 'full-access' }
  /** This machine's subprocess runtime cannot hold the named ceilings. */
  | { readonly kind: 'not-held'; readonly platform: NodeJS.Platform; readonly held: readonly SubprocessLimitDimension[] }
  /** The machine holds every stated ceiling, and still no provider accepted the request. */
  | { readonly kind: 'no-world' }

/** The runtime dimension that holds each stated ceiling; a disk ceiling has none yet (P3-10 phase 3). */
const HELD_BY: Readonly<Record<WorldCeilingName, SubprocessLimitDimension | undefined>> = {
  cpuMillicores: 'cpu',
  memoryBytes: 'memory',
  diskBytes: undefined,
  maxProcesses: 'processes',
}

/**
 * A call refused because its deployment states ceilings for its worlds and no
 * world bound for the call can hold them. Running the command anyway would
 * leave the ceiling a decoration, which is the failure R1 refuses for a spawn
 * (delegate ruling B-479).
 */
export class WorldCeilingsRefusedError extends Error {
  override readonly name = 'WorldCeilingsRefusedError'
  /** The stated ceilings that cannot be held, by their request names. */
  readonly ceilings: readonly WorldCeilingName[]
  /** Why they cannot be held here. */
  readonly refusal: WorldCeilingsRefusal

  constructor(
    stated: Readonly<Partial<Record<WorldCeilingName, number>>>,
    ceilings: readonly WorldCeilingName[],
    refusal: WorldCeilingsRefusal,
  ) {
    const named = ceilings.map(ceiling => `${ceiling} ${String(stated[ceiling])}`).join(', ')
    const why = refusal.kind === 'full-access'
      ? 'this session runs in danger-full-access, where no world is bound and nothing holds a ceiling; run it in a confined sandbox mode'
      : refusal.kind === 'not-held'
        ? `this machine's subprocess runtime (${refusal.platform}) holds ${refusal.held.length === 0 ? 'no ceiling' : refusal.held.join(', ')}; run it on a host that holds them`
        : 'this machine holds them, but no world provider accepted the rest of the request; check its other dimensions against the mounted providers'
    super(`the deployment's execution-worlds request states ${named}, and no world here can hold it: ${why}, or remove the ceiling from the request. Refusing to run the command unbounded.`)
    this.ceilings = ceilings
    this.refusal = refusal
  }
}

/**
 * Read the ceilings a spawn for `agent` must carry.
 *
 * No registry or no agent reads as `undefined`, and so do a bound world with
 * no ceiling and an unbound call whose deployment states none: the spawn runs
 * as it did before worlds carried ceilings. A deployment that states a
 * ceiling no bound world can hold refuses the call instead, and so does a
 * bound world with a disk ceiling, which a spawn cannot carry yet.
 * @param ctx - the tool's context, consulted for the optional `executionWorlds` registry, the sandbox policy and the subprocess runtime.
 * @param agent - the dispatching agent, absent for a call with no session.
 * @returns the ceilings to hand the spawn, or `undefined` when there are none.
 * @throws {@link WorldCeilingsRefusedError} when the deployment states a ceiling and no world bound for the call can hold it.
 * @throws when the bound world states a disk ceiling.
 */
export async function readWorldLimits(
  ctx: Context,
  agent: { readonly id: string; readonly session: unknown } | undefined,
): Promise<SubprocessLimits | undefined> {
  const worlds = ctx.get('executionWorlds') as WorldCeilingsPort | undefined
  if (worlds === undefined || agent === undefined) return undefined
  const binding = await worlds.bindingFor(agent)
  if (binding === undefined) {
    const stated = worlds.requestedCeilings()
    const named = (Object.keys(HELD_BY) as WorldCeilingName[]).filter(ceiling => stated[ceiling] !== undefined)
    if (named.length === 0) return undefined
    throw refusalFor(ctx, agent, stated, named)
  }
  const { cpuMillicores, memoryBytes, diskBytes } = binding.resources
  if (diskBytes !== undefined) {
    throw new Error('the bound world states a disk ceiling, which a spawn cannot carry yet (P3-10 phase 3); refusing to run the command unbounded on disk')
  }
  const limits: SubprocessLimits = {
    ...cpuMillicores === undefined ? {} : { cpuMillicores },
    ...memoryBytes === undefined ? {} : { memoryBytes },
    ...binding.maxProcesses === undefined ? {} : { maxProcesses: binding.maxProcesses },
  }
  return Object.keys(limits).length === 0 ? undefined : limits
}

/**
 * Say which stated ceilings cannot be held for this call, and why.
 * @param ctx - the tool's context, consulted for the sandbox policy and the subprocess runtime.
 * @param agent - the dispatching agent.
 * @param stated - every ceiling the deployment's request states.
 * @param named - the stated ceilings' names, in {@link HELD_BY} order.
 * @returns the refusal to throw, naming only ceilings that cannot be held.
 */
function refusalFor(
  ctx: Context,
  agent: { readonly session: unknown },
  stated: Readonly<Partial<Record<WorldCeilingName, number>>>,
  named: readonly WorldCeilingName[],
): WorldCeilingsRefusedError {
  const sandbox = ctx.get('sandboxPolicy') as SandboxModePort | undefined
  if (sandbox?.resolve({ session: agent.session }).mode === 'danger-full-access') {
    return new WorldCeilingsRefusedError(stated, named, { kind: 'full-access' })
  }
  const held = ctx.get('subprocess')?.enforceableLimits() ?? []
  const unheld = named.filter((ceiling) => {
    const dimension = HELD_BY[ceiling]
    return dimension === undefined || !held.includes(dimension)
  })
  return unheld.length === 0
    ? new WorldCeilingsRefusedError(stated, named, { kind: 'no-world' })
    : new WorldCeilingsRefusedError(stated, unheld, { kind: 'not-held', platform: process.platform, held })
}
