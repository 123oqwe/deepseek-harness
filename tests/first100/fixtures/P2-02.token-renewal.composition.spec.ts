/**
 * BLOCKED-331 closing conditions 1–4 on the shipped headless composition,
 * after the delegate's ruling that an expired session token is re-issued
 * under the same policy and the session is not ended.
 *
 * `./loader/p2-02-token-renewal/driver.ts` boots the SHIPPED headless profile
 * with a 1.5-second session-token TTL and a read-only probe tool, and runs one
 * scenario per describe: the root token past its expiry (condition 1), a
 * revoked root (condition 2), children whose tokens expire or whose parent's
 * token has expired (condition 3), and a code-mode program whose probe call
 * outlives the token its `run_code` call presented (condition 4).
 * @module tests/first100/fixtures/P2-02.token-renewal.composition
 */

import { fileURLToPath } from 'node:url'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p2-02-token-renewal/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-02-token-renewal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Deadline for one driver run: the child scenario waits up to 8 seconds twice per child. */
const DRIVER_TIMEOUT_MS = 60_000

/** The tail of the model-facing wording of an `expired` capability refusal. */
const EXPIRED = 'has expired'
/** The tail of the model-facing wording of a `revoked` capability refusal. */
const REVOKED = 'has been revoked'
/** The prefix the code-mode program puts on whatever it returns. */
const PROGRAM_RAN = 'A390-RAN: '

/** One token, by digest and claims, as the driver reports it. */
interface TokenReading {
  readonly digest: string
  readonly expiresAt: number
  readonly subject: string
  readonly tenant: string
  readonly capability: string
  readonly verbs: readonly string[]
  readonly parentDigest: string | null
  readonly delegationDepth: number
}

/** One root turn, as the driver reports it. */
interface TurnReading {
  readonly startedAt: number
  readonly heldAtStart: TokenReading | null
  readonly heldAfter: TokenReading | null
  readonly probeRan: boolean
  readonly results: readonly string[]
}

/** One child, as the driver reports it. */
interface ChildReading {
  readonly startedAt: number
  readonly firstSeen: { readonly at: number; readonly token: TokenReading | null } | null
  readonly call: { readonly at: number; readonly held: TokenReading | null; readonly parentHeld: TokenReading | null } | null
  readonly probeRan: boolean
  readonly results: readonly string[]
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly turns: readonly TurnReading[]
  readonly revocation?: string
  readonly digestsBeforeRevocation?: readonly string[]
  readonly children?: { readonly late: ChildReading; readonly afterExpiry: ChildReading }
}

/**
 * Run the driver once.
 * @param scenario - the scenario the driver runs.
 * @returns the driver's report.
 */
async function observe(scenario: 'root' | 'revoke' | 'child' | 'ptc'): Promise<Report> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `BLOCKED-331 observation: ${scenario}`,
    tempDirPrefix: `p2-02-token-renewal-${scenario}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, scenario],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: DRIVER_TIMEOUT_MS,
  })
  const json = /P2-02-RENEWAL (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${scenario} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as Report
}

describe('BLOCKED-331 condition 1: a root token past its expiry is re-issued under the same policy', () => {
  const reports: Report[] = []
  beforeAll(async () => { reports.push(await observe('root')) }, DRIVER_TIMEOUT_MS + 15_000)

  it('control: the probe runs before the expiry, and the second turn starts after it', () => {
    const [first, second] = reports[0]?.turns ?? []
    expect(first?.probeRan).toBe(true)
    expect(second?.heldAtStart?.expiresAt).toBeLessThanOrEqual(second?.startedAt ?? 0)
  })

  it('after the expiry the probe runs and no result says the token has expired', () => {
    const second = reports[0]?.turns[1]
    expect(second?.probeRan, JSON.stringify(second?.results)).toBe(true)
    expect(second?.results.filter(result => result.includes(EXPIRED))).toEqual([])
  })

  it('the session then holds a new root, unexpired when the turn started, with the subject, tenant, capability and verbs of the first token', () => {
    const [first, second] = reports[0]?.turns ?? []
    const renewed = second?.heldAfter
    expect(renewed?.digest).not.toBe(first?.heldAfter?.digest)
    expect(renewed?.parentDigest).toBeNull()
    expect(renewed?.expiresAt).toBeGreaterThan(second?.startedAt ?? Number.POSITIVE_INFINITY)
    expect({ subject: renewed?.subject, tenant: renewed?.tenant, capability: renewed?.capability, verbs: renewed?.verbs })
      .toEqual({ subject: first?.heldAfter?.subject, tenant: first?.heldAfter?.tenant, capability: first?.heldAfter?.capability, verbs: first?.heldAfter?.verbs })
  })
})

describe('BLOCKED-331 condition 2: a revoked root is never re-issued', () => {
  const reports: Report[] = []
  beforeAll(async () => { reports.push(await observe('revoke')) }, DRIVER_TIMEOUT_MS + 15_000)

  it('control: the probe runs before the revocation, and the revocation withdraws a recorded token', () => {
    expect(reports[0]?.turns).toHaveLength(3)
    expect(reports[0]?.turns[0]?.probeRan).toBe(true)
    expect(reports[0]?.revocation).toBe('revoked')
  })

  it('right after the revocation the probe does not run and the call is refused as revoked', () => {
    const second = reports[0]?.turns[1]
    expect(second?.probeRan, JSON.stringify(second?.results)).toBe(false)
    expect(second?.results.some(result => result.includes(REVOKED)), JSON.stringify(second?.results)).toBe(true)
  })

  it('no token is issued after the revocation, right after it or once every earlier token has expired', () => {
    const before = new Set(reports[0]?.digestsBeforeRevocation ?? [])
    const issuedAfter = (reports[0]?.turns ?? []).slice(1).flatMap(turn =>
      turn.heldAfter === null || before.has(turn.heldAfter.digest) ? [] : [turn.heldAfter.digest])
    expect(issuedAfter).toEqual([])
  })

  it('guard: once every earlier token has expired, the probe still does not run', () => {
    const third = reports[0]?.turns[2]
    expect(third?.probeRan, JSON.stringify(third?.results)).toBe(false)
  })
})

describe('BLOCKED-331 condition 3: a child token is derived from the current token of its parent, re-derived when it expires, and never born expired', () => {
  const reports: Report[] = []
  beforeAll(async () => { reports.push(await observe('child')) }, DRIVER_TIMEOUT_MS + 15_000)

  it('control: the first child starts with an unexpired token, and the first parent token expires before that child calls and before the second child starts', () => {
    const parentFirst = reports[0]?.turns[0]
    const { late, afterExpiry } = reports[0]?.children ?? {}
    expect(parentFirst?.probeRan).toBe(true)
    expect(late?.firstSeen?.token?.expiresAt).toBeGreaterThan(late?.firstSeen?.at ?? Number.POSITIVE_INFINITY)
    const expiry = parentFirst?.heldAfter?.expiresAt ?? Number.POSITIVE_INFINITY
    expect(expiry).toBeLessThan(late?.call?.at ?? 0)
    expect(expiry).toBeLessThan(afterExpiry?.startedAt ?? 0)
  })

  it('a child whose token expired before its call has it re-derived: the probe runs and no result says the token has expired', () => {
    const late = reports[0]?.children?.late
    expect(late?.probeRan, JSON.stringify(late?.results)).toBe(true)
    expect(late?.results.filter(result => result.includes(EXPIRED))).toEqual([])
  })

  it('a child started after the parent token expired is not born expired: its probe runs, and no child token has expired when it is first seen', () => {
    const { late, afterExpiry } = reports[0]?.children ?? {}
    expect(afterExpiry?.probeRan, JSON.stringify(afterExpiry?.results)).toBe(true)
    expect(afterExpiry?.call?.held?.expiresAt).toBeGreaterThan(afterExpiry?.call?.at ?? Number.POSITIVE_INFINITY)
    for (const child of [late, afterExpiry]) {
      expect(child?.firstSeen?.token?.expiresAt).toBeGreaterThan(child?.firstSeen?.at ?? Number.POSITIVE_INFINITY)
    }
  })

  it('guard: when each child calls, its token is derived from the parent token of that moment and does not outlive it', () => {
    const { late, afterExpiry } = reports[0]?.children ?? {}
    for (const call of [late?.call, afterExpiry?.call]) {
      expect(call?.held, 'the child called holding a token').toBeTruthy()
      expect(call?.parentHeld, 'the parent held a token when the child called').toBeTruthy()
      expect(call?.held?.parentDigest).toBe(call?.parentHeld?.digest)
      expect(call?.held?.expiresAt).toBeLessThanOrEqual(call?.parentHeld?.expiresAt ?? Number.NEGATIVE_INFINITY)
      expect(call?.held?.delegationDepth).toBe((call?.parentHeld?.delegationDepth ?? Number.NaN) + 1)
    }
  })
})

describe('BLOCKED-331 condition 4: a code-mode call that outlives the token of its batch is re-issued one or is refused with a reason that says so', () => {
  const reports: Report[] = []
  beforeAll(async () => { reports.push(await observe('ptc')) }, DRIVER_TIMEOUT_MS + 15_000)

  it('control: the program ran, so the run_code call itself was not refused', () => {
    const results = reports[0]?.turns[0]?.results ?? []
    expect(results.some(result => result.startsWith(PROGRAM_RAN)), JSON.stringify(results)).toBe(true)
  })

  it('the probe call either runs or is refused with a reason that names the expiry within the code-mode program', () => {
    const outcome = (reports[0]?.turns[0]?.results ?? []).find(result => result.startsWith(PROGRAM_RAN))?.slice(PROGRAM_RAN.length) ?? ''
    const renewed = outcome === 'probe tool ran'
    const saysSo = /expired/iu.test(outcome) && /run_code|program|batch|code[- ]mode/iu.test(outcome)
    expect(renewed || saysSo, outcome).toBe(true)
  })
})
