import { describe, expect, it } from 'vitest'
import { parseSnapshotManifest } from '../src/manifest.ts'
import { fixtureContext, stabilizeRefreshLog } from '../src/suite.ts'

describe('snapshot manifest', () => {
  it('parses an owning scenario', () => {
    expect(parseSnapshotManifest('version: 1\nprofile: headless\n')).toEqual({
      version: 1,
      profile: 'headless',
    })
  })

  it('parses a read-only session reference', () => {
    expect(parseSnapshotManifest([
      'version: 1',
      'profile: web',
      'session:',
      '  source: ../../session/tool-call-turn/session.jsonl',
      '',
    ].join('\n'))).toEqual({
      version: 1,
      profile: 'web',
      session: { source: '../../session/tool-call-turn/session.jsonl' },
    })
  })

  it('parses composition, recording, header, and exceptional replay metadata', () => {
    expect(parseSnapshotManifest([
      'version: 1',
      'scenario: sdk-case',
      'profile: sdk',
      'composition: continuable-subagent',
      'recording: authored',
      'header:',
      '  class: continuable-subagent',
      '  pin: true',
      '  systemPromptSource: session/text-turn',
      '  toolSchemasSource: session/text-turn',
      '  childSystemPrompts: [1]',
      '  childToolSchemas: [1, 2]',
      '  changes: 1',
      'replay:',
      '  override: true',
      'platform: posix',
      'permission: workspace-write',
      'environment:',
      '  DSH_SNAPSHOT_FAILURE: enabled',
      'workspace:',
      '  setup: fixed-mtimes',
      '  final: true',
      '  parent: home',
      'input:',
      '  task: Rejected before persistence.',
      '  attachments:',
      '    - id: sha256:abc',
      '      mediaType: image/png',
      '      data: aGVsbG8=',
      '',
    ].join('\n'))).toEqual({
      version: 1,
      scenario: 'sdk-case',
      profile: 'sdk',
      composition: 'continuable-subagent',
      recording: 'authored',
      header: {
        class: 'continuable-subagent',
        pin: true,
        systemPromptSource: 'session/text-turn',
        toolSchemasSource: 'session/text-turn',
        childSystemPrompts: [1],
        childToolSchemas: [1, 2],
        changes: 1,
      },
      replay: { override: true },
      platform: 'posix',
      permission: 'workspace-write',
      environment: { DSH_SNAPSHOT_FAILURE: 'enabled' },
      workspace: { setup: 'fixed-mtimes', final: true, parent: 'home' },
      input: {
        task: 'Rejected before persistence.',
        attachments: [{ id: 'sha256:abc', mediaType: 'image/png', data: 'aGVsbG8=' }],
      },
    })
  })

  it('parses independently optional header and input fields', () => {
    expect(parseSnapshotManifest([
      'version: 1',
      'profile: headless',
      'header:',
      '  class: default',
      'input:',
      '  task: Run once.',
      '',
    ].join('\n'))).toEqual({
      version: 1,
      profile: 'headless',
      header: { class: 'default' },
      input: { task: 'Run once.' },
    })

    expect(parseSnapshotManifest([
      'version: 1',
      'profile: sdk',
      'input:',
      '  attachments:',
      '    - id: sha256:one',
      '      mediaType: image/png',
      '      data: AQ==',
      '',
    ].join('\n'))).toEqual({
      version: 1,
      profile: 'sdk',
      input: { attachments: [{ id: 'sha256:one', mediaType: 'image/png', data: 'AQ==' }] },
    })
  })

  it.each([
    ['', 'manifest must be a mapping'],
    ['version: 2\nprofile: acp\n', 'manifest.version must equal 1'],
    ['version: 1\nprofile: private\n', 'manifest.profile must be headless, sdk, acp, or web'],
    ['version: 1\nprofile: acp\nextra: true\n', 'manifest has unknown field(s): extra'],
    ['version: 1\nprofile: acp\ncomposition: Not_Safe\n', 'manifest.composition must be a lower-kebab-case name'],
    ['version: 1\nprofile: acp\nrecording: maybe\n', 'manifest.recording must be live or authored'],
    ['version: 1\nprofile: acp\nheader: {}\n', 'manifest.header.class must be a lower-kebab-case name'],
    ['version: 1\nprofile: acp\nheader:\n  class: base\n  pin: false\n', 'manifest.header.pin must equal true when present'],
    ['version: 1\nprofile: acp\nheader:\n  class: base\n  childToolSchemas: [1, 1]\n', 'manifest.header.childToolSchemas must be an array of unique positive integers'],
    ['version: 1\nprofile: acp\nheader:\n  class: base\n  changes: -1\n', 'manifest.header.changes must be a non-negative integer'],
    ['version: 1\nprofile: acp\nheader:\n  class: base\n  systemPromptSource: ../bad\n', 'manifest.header.systemPromptSource must be a lower-kebab-case name or corpus-relative path'],
    ['version: 1\nprofile: acp\nreplay:\n  override: false\n', 'manifest.replay.override must equal true'],
    ['version: 1\nprofile: acp\nplatform: windows\n', 'manifest.platform must be posix or pwsh'],
    ['version: 1\nprofile: acp\npermission: root\n', 'manifest.permission must be read-only, workspace-write, or danger-full-access'],
    ['version: 1\nprofile: acp\nenvironment:\n  lower: value\n', 'manifest.environment must map uppercase environment names to strings'],
    ['version: 1\nprofile: acp\nworkspace: {}\n', 'manifest.workspace must not be empty'],
    ['version: 1\nprofile: acp\nworkspace:\n  final: false\n', 'manifest.workspace.final must equal true when present'],
    ['version: 1\nprofile: acp\nworkspace:\n  parent: temp\n', 'manifest.workspace.parent must equal home'],
    ['version: 1\nprofile: acp\ninput:\n  task: ""\n', 'manifest.input.task must be a non-empty string when present'],
    ['version: 1\nprofile: acp\ninput: {}\n', 'manifest.input must declare task or attachments'],
    ['version: 1\nprofile: acp\ninput:\n  attachments: []\n', 'manifest.input.attachments must be a non-empty array'],
    ['version: 1\nprofile: acp\ninput:\n  attachments:\n    - id: raw\n      mediaType: image/png\n      data: AQ==\n', 'manifest.input.attachments[0].id must start with sha256:'],
    ['version: 1\nprofile: acp\ninput:\n  attachments:\n    - id: sha256:one\n      mediaType: image\n      data: AQ==\n', 'manifest.input.attachments[0].mediaType must be a MIME type'],
    ['version: 1\nprofile: acp\ninput:\n  attachments:\n    - id: sha256:one\n      mediaType: image/png\n      data: ""\n', 'manifest.input.attachments[0].data must be non-empty base64'],
    ['version: 1\nprofile: acp\ninput:\n  attachments:\n    - id: sha256:one\n      mediaType: image/png\n      data: AQ==\n    - id: sha256:one\n      mediaType: image/png\n      data: Ag==\n', 'manifest.input.attachments must have unique ids'],
    ['version: 1\nprofile: acp\nsession: {}\n', 'manifest.session.source must be a non-empty string'],
    ['version: 1\nprofile: acp\nsession:\n  source: /tmp/session.jsonl\n', 'manifest.session.source must be a relative POSIX path'],
    ['version: 1\nprofile: acp\nsession:\n  source: ..\\session.jsonl\n', 'manifest.session.source must be a relative POSIX path'],
    ['version: 1\nprofile: !!js acp\n', 'invalid YAML'],
  ])('rejects invalid metadata', (source, message) => {
    expect(() => parseSnapshotManifest(source, 'case/snapshot.yml')).toThrow(message)
  })
})

describe('refresh preserves manifest idempotency digests across an inserted event', () => {
  const sessionLine = (id: string) => JSON.stringify({ type: 'session', version: 0, id, createdAt: 0 })
  const manifest = (actionId: string, key: string, sequence: number) => JSON.stringify({
    type: 'action/manifest-appended',
    seq: 0,
    time: 0,
    data: { actionId, argumentsHash: `hash-${actionId}`, sequence, idempotencyKey: key },
  })
  const other = (type: string) => JSON.stringify({ type, seq: 0, time: 0, data: {} })

  it('keeps every committed digest when the fresh log gained an event before them', () => {
    // The digest is taken over the session id, so a refresh that fails to copy
    // it writes a NEW digest into the fixture. Pairing fresh to committed by
    // position breaks the moment the fresh log gains an event anywhere earlier:
    // every later manifest then lines up against a record of another type, the
    // copy is skipped, and nothing notices because the comparison masks the
    // field. That is what this case exists to catch.
    const existing = [
      sessionLine('committed-session'),
      manifest('act-a', 'committed-key-a', 1),
      manifest('act-b', 'committed-key-b', 2),
      '',
    ].join('\n')
    const fresh = [
      sessionLine('fresh-session'),
      // The insertion. Everything after it shifts by one.
      other('action/risk-gated'),
      manifest('act-a', 'fresh-key-a', 1),
      manifest('act-b', 'fresh-key-b', 2),
      '',
    ].join('\n')

    const stabilized = stabilizeRefreshLog(fresh, existing, [], fixtureContext(fresh))

    expect(stabilized).toContain('committed-key-a')
    expect(stabilized).toContain('committed-key-b')
    expect(stabilized).not.toContain('fresh-key-a')
    expect(stabilized).not.toContain('fresh-key-b')
    // And the new event survives the refresh — preservation must not drop it.
    expect(stabilized).toContain('action/risk-gated')
  })

  it('preserves the digest even when the committed fixture normalized its arguments hash', () => {
    // A committed fixture may hold `{{argumentsHash}}` where the fresh record
    // holds the real digest, so an identity built from the hash matches nothing
    // and the refresh silently keeps the fresh key. Measured on the corpora
    // before this case existed: 130 digests rewritten with the hash in the key,
    // 0 with it out.
    const existing = [
      sessionLine('committed-session'),
      JSON.stringify({
        type: 'action/manifest-appended',
        seq: 0,
        time: 0,
        data: { actionId: 'act-a', argumentsHash: '{{argumentsHash}}', sequence: 1, idempotencyKey: 'committed-key-a' },
      }),
      '',
    ].join('\n')
    const fresh = [sessionLine('fresh-session'), manifest('act-a', 'fresh-key-a', 1), ''].join('\n')

    const stabilized = stabilizeRefreshLog(fresh, existing, [], fixtureContext(fresh))

    expect(stabilized).toContain('committed-key-a')
    expect(stabilized).not.toContain('fresh-key-a')
  })

  it('keeps a genuinely new action’s freshly computed digest', () => {
    // The negative control: an action with no committed counterpart has no
    // digest to preserve, and inventing one would be worse than recomputing.
    const existing = [sessionLine('committed-session'), manifest('act-a', 'committed-key-a', 1), ''].join('\n')
    const fresh = [
      sessionLine('fresh-session'),
      manifest('act-a', 'fresh-key-a', 1),
      manifest('act-new', 'fresh-key-new', 2),
      '',
    ].join('\n')

    const stabilized = stabilizeRefreshLog(fresh, existing, [], fixtureContext(fresh))

    expect(stabilized).toContain('committed-key-a')
    expect(stabilized).toContain('fresh-key-new')
  })
})
