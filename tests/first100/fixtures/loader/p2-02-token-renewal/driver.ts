/**
 * Driver for BLOCKED-331's cases: what a session and its children do once a
 * capability token expires or is revoked.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` (the shipped `capability-tokens` row with a 1.5-second
 * session-token TTL) under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, registers a read-only probe tool,
 * and creates the root agent after boot. The operator allows `run_code` at
 * once and declines every other question. `process.argv[3]` selects the
 * scenario:
 *
 * - `root`: one turn with a probe call, then a second one after the first
 *   token has expired;
 * - `revoke`: one turn, `revokeSession` on the root, a turn at once, and a
 *   turn after every token seen so far has expired;
 * - `child`: one parent turn, then a continuable child whose probe call comes
 *   after its token has expired, then, with the parent's token expired, a
 *   second child that calls the probe at once;
 * - `ptc`: code mode, one turn whose `run_code` program calls the probe after
 *   the token the call presented has expired.
 *
 * Tokens are reported by digest and claims, never by nonce. Whether a session
 * ran the probe is read from that session's own tool results. It prints one
 * `P2-02-RENEWAL <json>` line.
 * @module tests/first100/fixtures/loader/p2-02-token-renewal/driver
 */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { digestToken, type SignedCapabilityToken } from '@deepseek-ai/dsh-capability-token'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineContentToolFixture, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'p2-02-token-renewal-mock'
/** The probe tool every call names. */
const PROBE_TOOL = 'a390_probe'
/** The probe's result text when it ran. */
const PROBE_RAN = 'probe ran'
/** How long after the latest expiry a later turn starts. */
const PAST_EXPIRY_MS = 300
/** Longest wait for a child's first token, and for its first tool result. */
const CHILD_WAIT_MS = 8_000
/** Polling interval for the waits above. */
const POLL_MS = 10

/** The four scenarios. */
const SCENARIOS = ['root', 'revoke', 'child', 'ptc'] as const
type Scenario = typeof SCENARIOS[number]

/** One token, by digest and claims. */
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

/** What one root turn did. */
interface TurnReading {
  readonly label: string
  readonly startedAt: number
  readonly heldAtStart: TokenReading | null
  readonly heldAfter: TokenReading | null
  readonly probeRan: boolean
  readonly results: readonly string[]
}

/** What a child and its parent held when the child's first tool result arrived. */
interface CallReading {
  readonly at: number
  readonly held: TokenReading | null
  readonly parentHeld: TokenReading | null
}

/** What one child did. */
interface ChildReading {
  readonly startedAt: number
  readonly firstSeen: { readonly at: number; readonly token: TokenReading | null } | null
  readonly call: CallReading | null
  readonly probeRan: boolean
  readonly results: readonly string[]
}

/**
 * One token's digest and claims.
 * @param signed - the token, or `undefined` when none is held.
 * @returns the reading, or `null` when no token is held.
 */
function readToken(signed: SignedCapabilityToken | undefined): TokenReading | null {
  if (signed === undefined) return null
  const { token } = signed
  return {
    digest: digestToken(token),
    expiresAt: token.expiresAt,
    subject: token.subject,
    tenant: token.tenant,
    capability: token.capability,
    verbs: [...token.verbs],
    parentDigest: token.parentDigest,
    delegationDepth: token.delegationDepth,
  }
}

const scenario = process.argv[3]
if (!SCENARIOS.some(known => known === scenario)) throw new Error(`p2-02 token-renewal driver: unknown scenario ${String(scenario)}`)
const selected = scenario as Scenario
if (selected === 'ptc') process.env.DSH_TOOLS_MODE = 'ptc'

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'p2-02-token-renewal',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: () => undefined,
    }))
  },
})
try {
  const tokens = ctx.get('capabilityTokens')
  if (tokens === undefined) throw new Error('p2-02 token-renewal driver: the capability-token service is not mounted')
  let probeRuns = 0
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a read-only probe that records that it ran',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => {
      probeRuns += 1
      return Promise.resolve([{ type: 'text' as const, text: PROBE_RAN }])
    },
  }))

  const otherQuestions: string[] = []
  ctx.on('approval/request', (request) => {
    // The shipped headless profile asks once whether to trust the workspace;
    // the operator declines, which grants nothing. In code mode `run_code`
    // declares no risk domain tags, so the gate asks about it; the operator
    // allows it so the program can make the probe call.
    otherQuestions.push(request.toolName)
    return Promise.resolve(request.toolName === RUN_CODE_NAME ? 'allowed-once' as const : 'rejected' as const)
  })

  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error('p2-02 token-renewal driver: no root agent after creation')

  const results = new Map<string, string[]>()
  const childCalls = new Map<string, CallReading>()
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tool/result') return
    const text = event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join('')
    results.set(session.id, [...results.get(session.id) ?? [], text])
    if (session.id !== agent.id && !childCalls.has(session.id)) {
      childCalls.set(session.id, {
        at: Date.now(),
        held: readToken(tokens.sessionToken(session.id)),
        parentHeld: readToken(tokens.sessionToken(agent.id)),
      })
    }
  })

  /**
   * Run one root turn whose model opens with a probe call, and read what it did.
   * @param label - the turn's name in the report.
   * @returns the turn's reading.
   */
  const turn = async (label: string): Promise<TurnReading> => {
    const startedAt = Date.now()
    const heldAtStart = readToken(tokens.sessionToken(agent.id))
    const runsBefore = probeRuns
    const seen = results.get(agent.id)?.length ?? 0
    await runFixtureTurn(ctx, { task: `A-390-PROBE: ${label}` })
    return {
      label,
      startedAt,
      heldAtStart,
      heldAfter: readToken(tokens.sessionToken(agent.id)),
      probeRan: probeRuns > runsBefore,
      results: (results.get(agent.id) ?? []).slice(seen),
    }
  }

  /**
   * Wait until the latest expiry among `held` has passed, and then for {@link PAST_EXPIRY_MS} more.
   * @param held - the tokens whose expiry to wait out.
   */
  const outlive = async (held: readonly (TokenReading | null)[]): Promise<void> => {
    const latest = Math.max(Date.now(), ...held.flatMap(token => token === null ? [] : [token.expiresAt]))
    await delay(latest - Date.now() + PAST_EXPIRY_MS)
  }

  /**
   * Start one continuable child of the root and read its token and its first probe call.
   * @param parent - the root agent.
   * @param text - the child's prompt.
   * @returns the child's reading.
   */
  const child = async (parent: Agent, text: string): Promise<ChildReading> => {
    const subagents = ctx.get('subagents')
    if (subagents === undefined) throw new Error('p2-02 token-renewal driver: the subagent service is not mounted')
    const startedAt = Date.now()
    const started = await subagents.startContinuable({
      provider: 'spawn',
      label: 'a-390 child',
      request: { prompt: [{ type: 'text', text }], parent },
      signal: new AbortController().signal,
    })
    const id = started.childId
    let firstSeen: ChildReading['firstSeen'] = null
    for (let waited = 0; firstSeen === null && waited < CHILD_WAIT_MS; waited += POLL_MS) {
      const held = tokens.sessionToken(id)
      if (held === undefined) await delay(POLL_MS)
      else firstSeen = { at: Date.now(), token: readToken(held) }
    }
    for (let waited = 0; !childCalls.has(id) && waited < CHILD_WAIT_MS; waited += POLL_MS) await delay(POLL_MS)
    const childResults = results.get(id) ?? []
    return {
      startedAt,
      firstSeen,
      call: childCalls.get(id) ?? null,
      probeRan: childResults.includes(PROBE_RAN),
      results: childResults,
    }
  }

  let report: Record<string, unknown>
  if (selected === 'root') {
    const first = await turn('1: before the first token expires')
    await outlive([first.heldAfter])
    report = { turns: [first, await turn('2: after expiry')] }
  } else if (selected === 'revoke') {
    const first = await turn('1: before the revocation')
    const digestsBeforeRevocation = first.heldAfter === null ? [] : [first.heldAfter.digest]
    const revocation = await tokens.revokeSession(agent.id)
    const second = await turn('2: right after the revocation')
    await outlive([first.heldAfter, second.heldAfter])
    report = { revocation, digestsBeforeRevocation, turns: [first, second, await turn('3: after every token so far has expired')] }
  } else if (selected === 'child') {
    const first = await turn('1: the parent calls the probe before it starts a child')
    const late = await child(agent, 'A-390-CHILD-LATE: call the probe once your first request returns.')
    const afterExpiry = await child(agent, 'A-390-CHILD: call the probe at once.')
    report = { turns: [first], children: { late, afterExpiry } }
  } else {
    report = { turns: [await turn('1: the program calls the probe after the token has expired')] }
  }
  process.stdout.write(`P2-02-RENEWAL ${JSON.stringify({ scenario: selected, otherQuestions, ...report })}\n`)
} finally {
  await ctx.fiber.dispose()
}
