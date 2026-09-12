import { describe, expect, it } from 'vitest'
import { redactSessionSnapshotIds } from '../src/identity.ts'

const parentId = '11111111-1111-4111-8111-111111111111'
const childId = '22222222-2222-4222-8222-222222222222'
const messageId = '33333333-3333-4333-8333-333333333333'
const approvalId = '44444444-4444-4444-8444-444444444444'
const runId = '55555555-5555-4555-8555-555555555555'
const otherId = '66666666-6666-4666-8666-666666666666'
const proseUuid = '77777777-7777-4777-8777-777777777777'

describe('session snapshot identity redaction', () => {
  it('preserves typed relationships across parent and child logs', () => {
    const parent = [
      JSON.stringify({ type: 'session', id: parentId, createdAt: 1, cwd: '/tmp/work' }),
      JSON.stringify({
        type: 'agent/inbox/spliced',
        data: {
          inserted: [{
            role: 'user',
            content: [{ type: 'text', text: `keep unrelated ${proseUuid}; session ${childId}` }],
            source: { kind: 'user' },
            id: messageId,
          }],
        },
      }),
      JSON.stringify({ type: 'approval/asked', data: { id: approvalId } }),
      JSON.stringify({ type: 'tool-workflow/run-start', data: { runId } }),
      JSON.stringify({ type: 'example', data: { requestId: otherId, echoed: otherId } }),
      '',
    ].join('\n')
    const child = [
      JSON.stringify({ type: 'session', id: childId, parentSession: parentId, createdAt: 2, cwd: '/tmp/work' }),
      JSON.stringify({
        type: 'user/message',
        data: {
          role: 'user', content: [], source: { kind: 'user' }, id: messageId,
        },
      }),
      '',
    ].join('\n')

    const redacted = redactSessionSnapshotIds([parent, child])
    expect(redacted[0]).toContain('"id":"{{session:1}}"')
    expect(redacted[1]).toContain('"id":"{{session:2}}"')
    expect(redacted[1]).toContain('"parentSession":"{{session:1}}"')
    expect(redacted.join('\n').match(/\{\{message:1\}\}/g)).toHaveLength(2)
    expect(redacted[0]).toContain('"id":"{{approval:1}}"')
    // `run`, not `workflow`: a manifest's `runId` is an execution run, and the
    // old label told a fixture's next reader that a workflow had run.
    expect(redacted[0]).toContain('"runId":"{{run:1}}"')
    expect(redacted[0]).toContain('"requestId":"{{id:1}}"')
    expect(redacted[0]).toContain('"echoed":"{{id:1}}"')
    expect(redacted[0]).toContain(proseUuid)
    expect(redacted[0]).toContain('session {{session:2}}')
    expect(redactSessionSnapshotIds(redacted)).toEqual(redacted)
  })

  it('leaves a COMPOSITE runId to value-wise replacement, so redaction is idempotent', () => {
    // The refresh/verify divergence this rule closes: `anonymous-run:<uuid>`
    // whole-claimed to `{{run:1}}` on a live log, while the already-redacted
    // fixture read `anonymous-run:{{session:1}}` and could never produce the
    // first spelling again. Every session snapshot corpus disagreed with its
    // own fixtures until the claim was narrowed to whole ids.
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const log = [
      JSON.stringify({ type: 'session', id: sessionId }),
      JSON.stringify({ type: 'action/manifest-appended', data: { runId: `anonymous-run:${sessionId}` } }),
      '',
    ].join('\n')
    const once = redactSessionSnapshotIds([log])
    expect(once[0]).toContain('"runId":"anonymous-run:{{session:1}}"')
    expect(redactSessionSnapshotIds(once)).toEqual(once)
  })

  it('classifies semantic text plus command, RPC, and retry identity fields', () => {
    const semanticMessage = '88888888-8888-4888-8888-888888888888'
    const anonymousUser = '99999999-9999-4999-8999-999999999999'
    const retryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const source = [
      JSON.stringify({ type: 'not-a-session', data: { value: 'plain' } }),
      JSON.stringify({
        type: 'example',
        data: {
          commandId: 'command-7',
          rpcId: 'rpc-9',
          retryId,
          requestId: 'stable-readable-id',
          text: `Retain this as message ${semanticMessage}. Anonymous user: ${anonymousUser}`,
        },
      }),
    ].join('\n')

    const [redacted] = redactSessionSnapshotIds([source])
    expect(redacted).toContain('"commandId":"{{command:1}}"')
    expect(redacted).toContain('"rpcId":"{{rpc:1}}"')
    expect(redacted).toContain('"retryId":"{{retry:1}}"')
    expect(redacted).toContain('as message {{message:1}}')
    expect(redacted).toContain('Anonymous user: {{id:1}}')
    expect(redacted).toContain('"requestId":"stable-readable-id"')
    expect(redacted?.endsWith('\n')).toBe(false)
  })

  it('keeps a canonical token first seen through a generic id key', () => {
    const canonical = '{{message:7}}'
    const nextMessage = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const source = [
      JSON.stringify({ type: 'example', data: { requestId: canonical } }),
      JSON.stringify({
        type: 'user/message',
        data: { role: 'user', content: [], source: { kind: 'user' }, id: canonical },
      }),
      JSON.stringify({
        type: 'user/message',
        data: { role: 'user', content: [], source: { kind: 'user' }, id: nextMessage },
      }),
      '',
    ].join('\n')

    const [redacted] = redactSessionSnapshotIds([source])
    expect(redacted?.match(/\{\{message:7\}\}/g)).toHaveLength(2)
    expect(redacted).toContain('"id":"{{message:8}}"')
    expect(redacted).not.toContain('{{id:')
  })
})

describe('P3-01: the world binding carries two per-run values, numbered like every other id', () => {
  const worldA = '88888888-8888-4888-8888-888888888888'
  const worldB = '99999999-9999-4999-8999-999999999999'
  const specA = 'a'.repeat(64)
  const specB = 'b'.repeat(64)

  /** One log binding `count` worlds, in order. */
  function log(bindings: readonly { world: string; spec: string; provider: string }[]): string {
    return [
      JSON.stringify({ type: 'session', id: parentId, createdAt: 1, cwd: '/tmp/work' }),
      ...bindings.map(data => JSON.stringify({ type: 'action/world-bound', data })),
      '',
    ].join('\n')
  }

  it('tokenizes the world id and the spec digest, which no re-recording could pin', () => {
    // `world` is a `randomUUID()` and `spec` digests a spec carrying the run's
    // temporary workspace root, so a refreshed fixture reddens on the next run.
    const [redacted] = redactSessionSnapshotIds([log([{ world: worldA, spec: specA, provider: 'local' }])])
    expect(redacted).toContain('"world":"{{world:1}}"')
    expect(redacted).toContain('"spec":"{{worldSpec:1}}"')
  })

  it('leaves the PROVIDER raw, so a provider swap still shows as a diff', () => {
    // The control that keeps this from being the normalizer hiding behaviour:
    // what acceptance[0] asks a reader to see is WHICH provider minted the
    // world, and that value is not tokenized.
    const [redacted] = redactSessionSnapshotIds([log([{ world: worldA, spec: specA, provider: 'local' }])])
    expect(redacted).toContain('"provider":"local"')
  })

  it('numbers two DIFFERENT worlds differently, so one log with two bindings stays readable', () => {
    const [redacted] = redactSessionSnapshotIds([log([
      { world: worldA, spec: specA, provider: 'local' },
      { world: worldB, spec: specB, provider: 'fake-container' },
    ])])
    expect(redacted).toContain('"world":"{{world:1}}"')
    expect(redacted).toContain('"world":"{{world:2}}"')
    expect(redacted).toContain('"spec":"{{worldSpec:1}}"')
    expect(redacted).toContain('"spec":"{{worldSpec:2}}"')
  })

  it('gives two bindings of the SAME world one token, because the relationship is the point', () => {
    const [redacted] = redactSessionSnapshotIds([log([
      { world: worldA, spec: specA, provider: 'local' },
      { world: worldA, spec: specA, provider: 'local' },
    ])])
    expect(redacted?.match(/\{\{world:1\}\}/g)).toHaveLength(2)
    expect(redacted).not.toContain('{{world:2}}')
  })

  it('is idempotent, so a refresh and a replay of one run agree', () => {
    const redacted = redactSessionSnapshotIds([log([{ world: worldA, spec: specA, provider: 'local' }])])
    expect(redactSessionSnapshotIds(redacted)).toEqual(redacted)
  })
})
