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
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'

const corpus = fileURLToPath(new URL('../../../snapshots/', import.meta.url))

/** One recorded session log, parsed in append order. */
function log(relative: string): { type: string; data?: Record<string, unknown> }[] {
  const lines = readFileSync(join(corpus, relative), 'utf8').trimEnd().split('\n')
  // Line 0 is the session header, not an event.
  return lines.slice(1).map(line => JSON.parse(line) as { type: string; data?: Record<string, unknown> })
}

interface Principal { kind: string; id: string; tenantId: string; delegatedBy?: string }
interface Identity { principal: Principal; runId: string; chain: { entries: { principal: Principal }[] } }

/**
 * The identity a log is acting under, read the way the product reads it.
 *
 * The LAST `identity/attached`, not the first: a forked in-process session
 * inherits its parent's identity and then attaches its own, and
 * `runtime-context` answers with the later one (its frozen case reads
 * "returns the last identity/attached event's identity, ignoring earlier
 * ones"). Two logs in this corpus carry two -- `sdk/subagent-fork-in-process`'s
 * and `sdk/subagent-mixed`'s second in-process sessions -- and neither appends
 * a manifest today, so first and last agree on every claim below. Reading the
 * first would still be reading a prefix the product discarded.
 */
function attached(relative: string): Identity | undefined {
  const events = log(relative).filter(entry => entry.type === 'identity/attached')
  const event = events[events.length - 1]
  return event === undefined ? undefined : (event.data as unknown as { identity: Identity }).identity
}

/** The actor id on a log's first manifest, or undefined when it appended none. */
function firstActor(relative: string): string | undefined {
  const event = log(relative).find(entry => entry.type === 'action/manifest-appended')
  return event === undefined ? undefined : (event.data as { actor: string }).actor
}

/**
 * The identity in force when a log appended its first manifest.
 *
 * `attached` answers for the log as a whole; this answers for the moment an
 * action was attributed, which is what the join needs once a log can carry
 * more than one identity. They differ only for a log whose first manifest
 * precedes a later attachment, which no corpus log does today.
 */
function identityAtFirstAction(relative: string): Identity | undefined {
  const events = log(relative)
  const index = events.findIndex(entry => entry.type === 'action/manifest-appended')
  if (index === -1) return undefined
  const identities = events.slice(0, index).filter(entry => entry.type === 'identity/attached')
  const event = identities[identities.length - 1]
  return event === undefined ? undefined : (event.data as unknown as { identity: Identity }).identity
}

/** Every recorded session log under one corpus lane. */
function lane(name: string): string[] {
  return readdirSync(join(corpus, name), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap((entry) => {
      // One log per Session role: its highest recorded generation
      // (`session[.N][.vG].jsonl`), the same selection the snapshot harness makes.
      const highest = new Map<string, { file: string; generation: number }>()
      for (const file of readdirSync(join(corpus, name, entry.name))) {
        const match = /^session((?:\.\d+)?)(?:\.v(\d+))?\.jsonl$/u.exec(file)
        if (match === null) continue
        const role = match[1] ?? ''
        const generation = Number(match[2] ?? 0)
        const current = highest.get(role)
        if (current === undefined || generation > current.generation) highest.set(role, { file, generation })
      }
      return [...highest.values()].map(({ file }) => `${name}/${entry.name}/${file}`)
    })
}

/** The header row every log opens with, which names the generation that wrote it. */
function headerOf(relative: string): { version: number } {
  const [first = '{}'] = readFileSync(join(corpus, relative), 'utf8').split('\n')
  return JSON.parse(first) as { version: number }
}

/** Every surface a local user can start, as the corpus lanes name them. */
const SURFACES = ['session', 'acp', 'sdk'] as const

/**
 * The logs of one lane that the shipped writer would produce TODAY and that
 * recorded something.
 *
 * Both halves are what keeps this a claim about the product rather than about
 * the corpus. A log written at an older generation is an artefact no shipped
 * writer emits any more -- the four `snapshots/session` scenarios still stored
 * at v0, `text-turn`'s v1 and `sdk/multi-turn`'s v2 -- and demanding an
 * identity of it would be demanding that history change. A log with zero
 * events recorded no session to attach anything to: `acp/handshake` and
 * `acp/reject-extra-dirs` are handshake-only transcripts.
 *
 * Stated as a PREDICATE rather than as counts, because a count cannot refuse a
 * NEW corpus that attaches nothing -- it would simply be a number one higher.
 */
function currentGeneration(name: string): string[] {
  return lane(name).filter(path =>
    headerOf(path).version === sessionFormatCatalog.currentVersion && log(path).length > 0)
}

// `subagent-depth-two-rejection` is the scenario because it carries TWO hops
// and every one of its three logs appends a manifest, so each claim's join has
// a subject. `advanced-toolchain` has the same chain shape but its children
// dispatch no tool, so the actor half of the pair would read `undefined` there.
const ROOT = 'session/subagent-depth-two-rejection/session.v3.jsonl'
const CHILD = 'session/subagent-depth-two-rejection/session.1.v3.jsonl'
const GRANDCHILD = 'session/subagent-depth-two-rejection/session.2.v3.jsonl'

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

  it('attaches a HOST USER on every surface a local user starts, headless, ACP and the SDK server alike', () => {
    // This replaces a case that asserted the opposite -- that ACP and the SDK
    // server attach NOTHING, on the reading that a request arriving over a
    // socket is not the machine's host user. BLOCKED-291 measured that reading
    // out: both surfaces are started BY the local user, and a session that
    // attaches nothing acts as `anonymous:<sessionId>`, which is what made
    // P2-01's own acceptance unprovable for two of the three surfaces.
    //
    // The chain's ROOT is what is asserted, not the log's own principal: a
    // subagent session legitimately acts as `agent:<id>`, and 16 of the 102
    // current-generation logs outside `sdk` do. What must hold everywhere is
    // that following the chain back reaches a person -- which is the whole of
    // what "traceable to the host user" means.
    for (const surface of SURFACES) {
      const logs = currentGeneration(surface)
      expect(logs.length, `${surface} contributed no current-generation log, so this surface proved nothing`)
        .toBeGreaterThan(0)
      for (const path of logs) {
        const identity = attached(path)
        expect(identity, `${path} attached no identity`).toBeDefined()
        expect(identity?.chain.entries[0]?.principal.kind, `${path} does not root at a user`).toBe('user')
        // Delegation is the ONLY reason a log acts as something other than the
        // person: a session that delegated to nobody carries one chain entry
        // and IS the user. Asserting both halves is what keeps a root session
        // from passing with a synthetic principal whose chain was copied from
        // its parent.
        expect(identity?.principal.kind === 'user', `${path}: chain length and principal kind disagree`)
          .toBe(identity?.chain.entries.length === 1)
      }
    }
  })

  it('attributes every recorded action to the principal its own log attached, on all three surfaces', () => {
    // The join, applied to the whole corpus rather than to three named
    // scenarios. It holds for a log of ANY generation: an old log that
    // appended a manifest without attaching anything would fail here even
    // though the case above does not reach it.
    for (const surface of SURFACES) {
      const pairs = lane(surface).filter(path => firstActor(path) !== undefined)
      expect(pairs.length, `${surface} recorded no action, so the join has no subject there`).toBeGreaterThan(0)
      for (const path of pairs) {
        const identity = identityAtFirstAction(path)
        expect(identity, `${path} attributed an action and attached nothing`).toBeDefined()
        expect(firstActor(path), path).toBe(identity?.principal.id)
      }
    }
  })

  it('names more than one principal across those attributions, so the join is not one constant satisfying itself', () => {
    // Without this, `actor === attached principal` would also pass on a corpus
    // where every log attached the same synthetic id -- which is exactly the
    // shape the pre-identity corpus had, with `anonymous:<sessionId>` in both
    // halves. Today the attributed principals are the host user and the
    // subagent principals delegated from it.
    const principals = new Set(SURFACES.flatMap(surface => lane(surface))
      .filter(path => firstActor(path) !== undefined)
      .map(path => identityAtFirstAction(path)?.principal.id))

    expect(principals.size).toBeGreaterThan(1)
  })
})
