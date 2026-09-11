/**
 * The stable identifier of the host user one harness home belongs to
 * (first100 registry P2-01 acceptance[0]).
 *
 * A random UUID persisted as a bare line in `.host-user-id` inside the harness
 * home resolved by {@link resolveDshHome} (`$DSH_HOME` > `~/.dsh`), never
 * derived from the OS username, hostname, network address, or any other
 * identifying source. It is scoped to the harness home, not the machine: every
 * process sharing one `$DSH_HOME` acts as the same host user, and deleting the
 * file makes the next launch a different one.
 *
 * **Deliberately NOT `@deepseek-ai/dsh-anonymous-user-id`, and the separation
 * is the point.** That package's id is a telemetry subject: it rides model
 * requests as `user`, it is an OTel `user.id` attribute sent off-box, and
 * `/feedback` prints it as "Anonymous user". This one is an authorization
 * subject — the `UserPrincipal.id` a workspace trust upgrade is granted under
 * and the actor an action manifest is attributed to. Reusing one uuid for both
 * would mean the value a deployment ships to a telemetry backend is the same
 * value its audit trail names as the human who authorized a change. Same
 * mechanism, same home, two files, two roles.
 *
 * Reads and writes are synchronous so boot-time consumers can use one API,
 * and the result is memoized per resolved file path.
 *
 * @module @deepseek-ai/dsh-host-user-id
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createChain, createUserPrincipal } from '@deepseek-ai/dsh-principal'
import type { IdentityContext, PrincipalId, RunId, TenantId } from '@deepseek-ai/dsh-principal/types'

/** A harness-home-scoped host user id (random UUID v4). */
export type HostUserId = Branded<'HostUserId'>

/** File inside the harness home storing the id: a bare UUID line, no wrapper format. */
export const HOST_USER_ID_FILE_NAME = '.host-user-id'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ambient hooks for locating and generating the id; every field has a default. */
export interface HostUserIdOptions {
  /** Environment consulted for `DSH_HOME`; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** UUID generator; defaults to `crypto.randomUUID` (test hook). */
  randomUUID?: () => string
}

/** Process-lifetime memo keyed by resolved file path, so distinct test homes never share an id. */
const memo = new Map<string, HostUserId>()

/** Read a valid persisted id from the file, or `undefined` when absent or not a UUID. */
function readPersistedId(file: string): HostUserId | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    // Absent or unreadable: the caller mints and persists a fresh id.
    return undefined
  }
  const value = text.trim()
  return UUID_PATTERN.test(value) ? (value as HostUserId) : undefined
}

/**
 * Return this harness home's host user id, creating and persisting one on
 * first use.
 *
 * A concurrent first launch is settled by an exclusive-create write: the loser
 * rereads the winner's id. Persistence is best-effort — an unwritable home
 * still yields a usable id for the current run rather than failing the boot,
 * and the consequence is stated rather than hidden: a run under an unwritable
 * home acts as a host user whose id is new each launch, so its actions stay
 * traceable WITHIN the run and cannot be correlated across runs.
 * @param options - home-location and UUID-generation seams.
 * @returns the stable per-harness-home host user id.
 */
export function getOrCreateHostUserId(options: HostUserIdOptions = {}): HostUserId {
  const file = join(resolveDshHome(undefined, options.env ?? process.env), HOST_USER_ID_FILE_NAME)
  const cached = memo.get(file)
  if (cached !== undefined) return cached

  let id = readPersistedId(file)
  if (id === undefined) {
    const generate = options.randomUUID ?? randomUUID
    const created = generate() as HostUserId
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${created}\n`, { encoding: 'utf8', flag: 'wx' })
      id = created
    } catch {
      // A `wx` refusal (EEXIST) covers both a concurrent winner and a
      // pre-existing corrupt file: the reread adopts a valid winner, and an
      // invalid reread falls through to the overwrite path. Non-EEXIST
      // failures (read-only home) land there too, accepted best-effort below.
      id = readPersistedId(file)
      if (id === undefined) {
        try {
          writeFileSync(file, `${created}\n`, 'utf8')
        } catch {
          // Best-effort persistence: keep the fresh id in memory even when the
          // home is unwritable, so this run still acts as ONE host user.
        }
        id = created
      }
    }
  }
  memo.set(file, id)
  return id
}

/**
 * The tenant a local host user acts in.
 *
 * Fixed, not configurable. A harness home belongs to one person on one
 * machine, and there is no second tenant for that person to be in. A
 * deployment that has tenants attaches its own `IdentityContext` at its own
 * boot instead of calling this.
 */
const LOCAL_TENANT = 'local' as TenantId

/**
 * The identity a shipped local boot attaches for its host user
 * (first100 registry P2-01 acceptance[0], first half).
 *
 * A one-hop chain rooted at the host user: this person started this run and
 * delegated to nobody. A run that goes on to delegate extends the chain from
 * here, so the root stays the same principal however deep the delegation goes.
 *
 * Call this at a root creation site a LOCAL host user drives — the `dsh`
 * launcher family. A request that arrived over a socket is not the machine's
 * host user, and attaching this to one would make a remote caller claim to be
 * them.
 * @param runId - the run this identity acts inside; one per created agent.
 * @param options - home-location and UUID-generation seams, forwarded to {@link getOrCreateHostUserId}.
 * @returns the identity context to pass as `AgentOptions.identity`.
 */
export function hostUserIdentity(runId: RunId, options: HostUserIdOptions = {}): IdentityContext {
  const principal = createUserPrincipal(getOrCreateHostUserId(options) as string as PrincipalId, LOCAL_TENANT)
  return { principal, runId, chain: createChain(principal, Date.now()) }
}
