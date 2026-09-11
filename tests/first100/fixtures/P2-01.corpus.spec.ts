/**
 * Epic P2-01 acceptance[0], read from the recorded corpus: who a shipped boot
 * says is acting, and what a delegated child inherits.
 *
 * **Why the corpus and not a fixture.** `snapshots/session/` is the output of a
 * real `dsh --profile headless` process, replayed keylessly and compared byte
 * for byte. A fixture built for these claims would prove that the fixture
 * attaches an identity; the corpus proves the product does, in the same logs
 * every other epic's evidence is read from.
 *
 * **Why each claim is a PAIR.** `action/manifest-appended` records
 * `actor: manifest.actor.id` — the id string alone (`core/tools/src/manifest-log.ts`),
 * with no kind, tenant or chain beside it. The chain lives on
 * `identity/attached`. So each claim joins the two: the identity a session
 * attached, AND the first manifest attributing an action to exactly that
 * principal. The first half alone would show an identity was attached and
 * nothing about whether actions ran under it.
 *
 * That join is also what "traceable" means here — from one action you reach the
 * root through its own session log, not through a chain copied into every
 * manifest (§12.85 note 43).
 *
 * Before P2-01's U2 stage no shipped profile attached anything (BLOCKED-200),
 * so both dispatch paths synthesized an `anonymous-dev` principal named after
 * the session; and `resolveChildAgentOptions` did not carry `identity` while
 * `extendChain` had zero production callers, so a delegated child was
 * untraceable to the person who started the run however well the root was
 * attached.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const corpus = fileURLToPath(new URL('../../../snapshots/', import.meta.url))

/** One recorded session log, parsed in append order. */
function log(relative: string): { type: string; data?: Record<string, unknown> }[] {
  const lines = readFileSync(join(corpus, relative), 'utf8').trimEnd().split('\n')
  // Line 0 is the session header, not an event.
  return lines.slice(1).map(line => JSON.parse(line) as { type: string; data?: Record<string, unknown> })
}

interface Principal { kind: string; id: string; tenantId: string; delegatedBy?: string }
interface Identity { principal: Principal; runId: string; chain: { entries: { principal: Principal }[] } }

/** The identity a log attached, which a shipped local boot writes as its first event. */
function attached(relative: string): Identity | undefined {
  const event = log(relative).find(entry => entry.type === 'identity/attached')
  return event === undefined ? undefined : (event.data as unknown as { identity: Identity }).identity
}

/** The actor id on a log's first manifest, or undefined when it appended none. */
function firstActor(relative: string): string | undefined {
  const event = log(relative).find(entry => entry.type === 'action/manifest-appended')
  return event === undefined ? undefined : (event.data as { actor: string }).actor
}

/** Every recorded session log under one corpus lane. */
function lane(name: string): string[] {
  return readdirSync(join(corpus, name), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => readdirSync(join(corpus, name, entry.name))
      .filter(file => /^session(\.\d+)?\.jsonl$/u.test(file))
      .map(file => `${name}/${entry.name}/${file}`))
}

// `subagent-depth-two-rejection` is the scenario because it carries TWO hops
// and every one of its three logs appends a manifest, so each claim's join has
// a subject. `advanced-toolchain` has the same chain shape but its children
// dispatch no tool, so the actor half of the pair would read `undefined` there.
const ROOT = 'session/subagent-depth-two-rejection/session.jsonl'
const CHILD = 'session/subagent-depth-two-rejection/session.1.jsonl'
const GRANDCHILD = 'session/subagent-depth-two-rejection/session.2.jsonl'

describe('P2-01 acceptance[0] — a shipped boot names who is acting', () => {
  it('attaches the HOST USER as the root, and the first action is attributed to exactly that principal', () => {
    const identity = attached(ROOT)
    expect(identity?.principal.kind).toBe('user')
    expect(identity?.principal.tenantId).toBe('local')
    // One entry: this person started the run and has delegated to nobody yet.
    expect(identity?.chain.entries).toHaveLength(1)
    // The join. Without it this case would hold on a profile that attached an
    // identity nothing ever acted under.
    expect(firstActor(ROOT)).toBe(identity?.principal.id)
  })

  it('delegates ONE hop to the child, whose chain still roots at the same host user', () => {
    const root = attached(ROOT)
    const child = attached(CHILD)
    expect(child?.chain.entries).toHaveLength(2)
    // Field for field, not "same id": a chain agreeing on the id while
    // disagreeing on kind or tenant would be a different root wearing its name.
    expect(child?.chain.entries[0]?.principal).toEqual(root?.chain.entries[0]?.principal)
    expect(child?.principal.kind).toBe('agent')
    expect(child?.principal.delegatedBy).toBe(root?.principal.id)
    expect(firstActor(CHILD)).toBe(child?.principal.id)
  })

  it('keeps the SAME root two hops down, so depth does not dilute the chain', () => {
    // One hop could be a special case. The grandchild's chain is three entries
    // whose first is still the host user who started the run, which is what
    // acceptance[0]'s "full delegation chain" asks for.
    const root = attached(ROOT)
    const grandchild = attached(GRANDCHILD)
    expect(grandchild?.chain.entries).toHaveLength(3)
    expect(grandchild?.chain.entries[0]?.principal).toEqual(root?.chain.entries[0]?.principal)
    expect(grandchild?.principal.delegatedBy).toBe(attached(CHILD)?.principal.id)
    expect(firstActor(GRANDCHILD)).toBe(grandchild?.principal.id)
  })

  it('gives the child its own principal and its own run, so parent and child are not one actor', () => {
    // The control. A child that simply inherited the parent's identity would
    // satisfy "roots at the same user" trivially, and reusing the parent's run
    // id would put two agents in one run — the shape P4-12 keys a ledger scope
    // on.
    const root = attached(ROOT)
    const child = attached(CHILD)
    expect(child?.principal.id).not.toBe(root?.principal.id)
    expect(child?.runId).not.toBe(root?.runId)
    expect(firstActor(CHILD)).not.toBe(firstActor(ROOT))
  })

  it('OQ30: the local launcher attaches a host user and the remote surfaces attach nothing', () => {
    // The ruling's boundary, read as counts rather than asserted in prose. A
    // request that arrived over a socket is not the machine's host user, so
    // ACP and the SDK server attach nothing; every headless log a local
    // launcher wrote carries one.
    const headless = lane('session').filter(path => attached(path) !== undefined)
    expect(headless.length).toBeGreaterThan(1)
    for (const path of [...lane('sdk'), ...lane('acp')]) {
      expect(attached(path), `${path} must attach no host identity`).toBeUndefined()
    }
  })
})
