/**
 * P8-01 acceptance[3] and BLOCKED-314 closing condition 2: the fingerprinted
 * protocol surface names exactly the methods the SDK server dispatches and the
 * names it sends to its peer, both read from the server's own source.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SERVER_PROTOCOL_SURFACE } from '../src/server.ts'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/server.ts', import.meta.url)), 'utf8')

/**
 * The method names `handleRequest` dispatches, from its `case` labels.
 * @returns the names in source order.
 */
function dispatched(): string[] {
  const start = SOURCE.indexOf('async handleRequest(')
  const end = SOURCE.indexOf('default:', start)
  if (start === -1 || end === -1) throw new Error('handleRequest or its default branch was not found in server.ts')
  return [...SOURCE.slice(start, end).matchAll(/case '([^']+)':/gu)].map(match => match[1] ?? '')
}

/**
 * The names the server sends to its peer, from every `.notify('…'` and `.request('…'` literal.
 * @returns the names in source order.
 */
function sent(): string[] {
  return [...SOURCE.matchAll(/\.(?:notify|request)\('([^']+)'/gu)].map(match => match[1] ?? '')
}

describe('P8-01 acceptance[3]: the fingerprinted surface is the surface the server answers', () => {
  it('names exactly the methods the dispatcher handles and the names the server sends', () => {
    const surface = [...new Set([...SERVER_PROTOCOL_SURFACE.methods, ...SERVER_PROTOCOL_SURFACE.events].map(entry => entry.name))].sort()
    const source = [...new Set([...dispatched(), ...sent()])].sort()
    // The scan finds every name this build is known to use, so an empty or a
    // partial scan cannot pass as agreement.
    expect(source).toEqual(expect.arrayContaining([
      'host.control', 'human/question', 'initialize', 'session.event', 'session.status',
      'session/prompt', 'shutdown', 'subagent.finished', 'subagent.started',
    ]))
    expect(surface).toEqual(source)
  })
})
