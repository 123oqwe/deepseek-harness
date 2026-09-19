/**
 * The classifier's two jobs: pair a hunk correctly, and call a non-clock field
 * what it is.
 * @module scripts/first100/refresh-drift-report.spec
 */

import { describe, expect, it } from 'vitest'
import { classifyDrift, renderDriftReport } from './refresh-drift-report.ts'

/** Build a one-hunk patch over one file. */
function patch(file: string, removed: readonly string[], added: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,2 +1,2 @@',
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    '',
  ].join('\n')
}

describe('refresh drift report', () => {
  it('pairs a hunk by position, not by adjacency', () => {
    // A unified diff groups removals before insertions. Pairing `-` with the
    // `+` that follows it compares the FIRST removed line with the LAST
    // removed line's replacement, which reports fields that never changed --
    // reading that output once produced a "the record type changed" finding
    // the raw hunk disproved.
    const text = patch('snapshots/x/writer.expected.jsonl', [
      '{"type":"assistant/message","data":{"stream":[{"time":1}]}}',
      '{"type":"action/manifest-appended","data":{"idempotencyKey":"a"}}',
    ], [
      '{"type":"assistant/message","data":{"stream":[{"time":2}]}}',
      '{"type":"action/manifest-appended","data":{"idempotencyKey":"b"}}',
    ])

    const report = classifyDrift(text)

    expect(report.clock.map(row => row.field)).toEqual(['time'])
    expect(report.semantic.map(row => row.field)).toEqual(['idempotencyKey'])
  })

  it('sends a tool result rewritten by a missing sandbox backend to the failing column', () => {
    // The two files run 35467913630 corrupted. This is the case the self-check
    // exists for: it must be red, and it must be red for a named field.
    const text = patch('snapshots/sdk/bash-tool/session.v3.jsonl',
      ['{"content":[{"type":"text","text":"dsh-sdk-proof-7391"}]}'],
      ['{"content":[{"type":"text","text":"Error: sandbox mode workspace-write is requested"}]}'])

    const report = classifyDrift(text)

    expect(report.semantic.map(row => row.field)).toEqual(['text'])
    expect(report.clock).toEqual([])
  })

  it('reports an unpaired hunk rather than guessing which line replaced which', () => {
    const text = patch('snapshots/x/session.v3.jsonl', ['{"a":1}'], ['{"a":1}', '{"b":2}'])

    const report = classifyDrift(text)

    expect(report.semantic).toEqual([
      { file: 'snapshots/x/session.v3.jsonl', field: '(unpaired hunk: 1 removed, 2 added)' },
    ])
  })

  it('reports EVERY differing leaf on a line, not the first one', () => {
    // The false green this classifier was rejected for once: the corrupted
    // `bash-tool` lines differ at `text`, `isError` AND `error`, and a version
    // that stopped at the first difference put a rewritten tool result in the
    // reported-only column whenever a clock happened to come first.
    const text = patch('snapshots/x/session.v3.jsonl',
      ['{"data":{"time":1,"message":{"isError":false,"text":"ok"}}}'],
      ['{"data":{"time":2,"message":{"isError":true,"text":"Error: no sandbox backend"}}}'])

    const report = classifyDrift(text)

    expect(report.clock.map(row => row.field)).toEqual(['time'])
    expect(report.semantic.map(row => row.field).sort()).toEqual(['isError', 'text'])
  })

  it('sees a hunk that only inserts lines', () => {
    // A scan entered only on `-` never reaches an insertion-only hunk, so new
    // records would arrive in the patch completely unclassified.
    const text = [
      'diff --git a/snapshots/x/session.v3.jsonl b/snapshots/x/session.v3.jsonl',
      '--- a/snapshots/x/session.v3.jsonl',
      '+++ b/snapshots/x/session.v3.jsonl',
      '@@ -1,0 +1,1 @@',
      '+{"type":"identity/attached"}',
      '',
    ].join('\n')

    const report = classifyDrift(text)

    expect(report.semantic).toEqual([
      { file: 'snapshots/x/session.v3.jsonl', field: '(unpaired hunk: 0 removed, 1 added)' },
    ])
  })

  it('names the full leaf path so a reviewer can find it in a long record', () => {
    const text = patch('snapshots/x/f.jsonl',
      ['{"data":{"stream":[{"chunk":{"a":1}}]}}'],
      ['{"data":{"stream":[{"chunk":{"a":2}}]}}'])

    expect(classifyDrift(text).semantic[0]?.leaf).toBe('data.stream[0].chunk.a')
  })

  it('keeps every clock field this channel has actually seen out of the failing column', () => {
    const fields = ['time', 'time0', 'durationMs', 'childCreatedAt']
    const text = fields.map((field, index) => patch(
      `snapshots/x/f${index}.jsonl`,
      [`{"data":{"${field}":1}}`],
      [`{"data":{"${field}":2}}`],
    )).join('')

    const report = classifyDrift(text)

    expect(report.clock.map(row => row.field)).toEqual(fields)
    expect(report.semantic).toEqual([])
  })

  it('attributes each drift to the file its hunk belongs to', () => {
    const text = patch('snapshots/a.jsonl', ['{"x":1}'], ['{"x":2}'])
      + patch('snapshots/b.jsonl', ['{"time":1}'], ['{"time":2}'])

    const report = classifyDrift(text)

    expect(report.semantic).toEqual([{ file: 'snapshots/a.jsonl', field: 'x' }])
    expect(report.clock).toEqual([{ file: 'snapshots/b.jsonl', field: 'time' }])
  })

  it('fails a binary delta rather than reading it as an unchanged file', () => {
    // `fixtures.patch` is generated `--binary`, and a binary delta carries no
    // line starting with `-` or `+`. A classifier that only reads those lines
    // therefore sees nothing and says nothing -- and `snapshots/` holds eight
    // images. A file is in the patch because it CHANGED, so producing no
    // entry for it means the classifier could not read it, not that it is
    // clean.
    const text = [
      'diff --git a/snapshots/web/minimal-preset/shot.png b/snapshots/web/minimal-preset/shot.png',
      'index 7c1b2a4..9f3e8d1 100644',
      'GIT binary patch',
      'delta 41',
      'zcmV+^0O0`~0RR91000000000000000000000000000000000000000000000000000',
      '',
      'delta 12',
      'zcmZo@U|', '',
    ].join('\n')

    const report = classifyDrift(text)

    expect(report.semantic).toEqual([{
      file: 'snapshots/web/minimal-preset/shot.png',
      field: '(changed, but no readable line: a binary delta or an unknown diff form)',
    }])
    expect(report.clock).toEqual([])
  })

  it('does not double-report a file that already produced an entry', () => {
    const text = patch('snapshots/b.jsonl', ['{"time":1}'], ['{"time":2}'])

    const report = classifyDrift(text)

    expect(report.clock).toHaveLength(1)
    expect(report.semantic).toEqual([])
  })

  it('renders both columns, naming the empty one rather than omitting it', () => {
    const rendered = renderDriftReport(classifyDrift(patch('snapshots/b.jsonl', ['{"time":1}'], ['{"time":2}'])))

    expect(rendered).toContain('clock fields (reported, not failing): 1')
    expect(rendered).toContain('OTHER fields (a refresh on a current tree must show none): none')
  })
})
