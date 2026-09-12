/**
 * P2-10 C: the dsh Cedar schema declares exactly what `toCedarRequest` sends.
 *
 * The drift case is the stage's load-bearing one, and it runs in BOTH
 * directions on purpose. A schema wider than the request builder is the
 * failure mode measured in `preflight-P2-10-C.md`: a policy written against
 * the speculative half loads clean, never matches, and reports itself only
 * once per decision. A schema narrower than the builder refuses a policy a
 * deployment is entitled to write.
 *
 * The comparison is between two independent statements of the same fact — the
 * object literal inside the mapper, and the schema document — so it fails when
 * either moves without the other.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toCedarRequest } from '@deepseek-ai/dsh-policy-engine-cedar'
import { DSH_ACTION_TYPE, DSH_CONTEXT_KEYS, DSH_PRINCIPAL_TYPE, DSH_RESOURCE_TYPE } from '../src/schema.ts'
import { samplePolicyRequest } from './sample-request.ts'

describe('P2-10 C: the schema and the request builder state the same vocabulary', () => {
  it('declares every context key the request builder sends, and no others', () => {
    const sent = Object.keys(toCedarRequest(samplePolicyRequest()).context).sort()

    expect([...DSH_CONTEXT_KEYS].sort()).toStrictEqual(sent)
  })

  it('declares the three entity types the request builder names', () => {
    const built = toCedarRequest(samplePolicyRequest())

    expect(built.principal.type).toBe(DSH_PRINCIPAL_TYPE)
    expect(built.action.type).toBe(DSH_ACTION_TYPE)
    expect(built.resource.type).toBe(DSH_RESOURCE_TYPE)
  })

  it('declares the same keys the language document does, so the prose is checkable and not decorative', () => {
    // Under ruling (b) `docs/policy/language.md` IS the schema's authority, so
    // it has to be machine-comparable rather than a description someone hopes
    // is current. The table rows are read, not the whole page: a doc that
    // drifts from the constant fails here, in either direction.
    const page = readFileSync(new URL('../../../../docs/policy/language.md', import.meta.url), 'utf8')
    // Scoped to the context-key table: the page carries other tables whose
    // first column is also a backticked identifier, and a whole-page scan
    // would compare this constant against the refusal names too.
    const table = page.slice(page.indexOf('exactly ten keys'), page.indexOf('## What a policy set is refused for'))
    const documented = [...table.matchAll(/^\| `([a-zA-Z]+)` \| /gmu)].map(match => match[1] as string)

    expect(documented.sort()).toStrictEqual([...DSH_CONTEXT_KEYS].sort())
  })

  it('states ten context keys, so a silent addition to either side is visible as a count', () => {
    // The count is pinned separately from the comparison above: a change that
    // adds one key to BOTH sides passes the comparison and is still a
    // vocabulary change someone should have to acknowledge.
    expect(DSH_CONTEXT_KEYS).toHaveLength(10)
  })
})
