#!/usr/bin/env node
/**
 * Test driver for P3-10's world-ceiling acceptance: boot the SHIPPED headless
 * profile under one deployment overlay, let a scripted model run two commands
 * through the real `bash` tool, and leave the session log for the spec to read.
 *
 * The overlay named on the command line is either the deployment's ceiling
 * (`limited.patch.yml`) or the control (`control.patch.yml`); everything else
 * is `base.patch.yml` over the shipped layers. Only the model is scripted: the
 * two commands are what an agent would run, and their tool results are what
 * the model would see.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** Children the fork bomb tries to start: twice the deployment's ceiling of 64. */
const FORK_ATTEMPTS = 128

/** MiB the balloon tries to hold: three times the deployment's ceiling of 256 MiB. */
const BALLOON_MEBIBYTES = 768

/**
 * Start `attempts` sleeping children at once, count which started and which the
 * kernel refused, and report both once every attempt has settled. The cgroup's
 * own count is added when it can be read, as a record rather than a verdict.
 */
const FORK_BOMB = `const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const attempts = Number(process.argv[2])
const children = []
let started = 0
let refused = 0
let pending = attempts
function pidsCurrent() {
  try {
    const path = /^0::(.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))[1]
    return readFileSync('/sys/fs/cgroup' + path + '/pids.current', 'utf8').trim()
  } catch (error) {
    return 'unreadable: ' + error.message
  }
}
function settle() {
  pending -= 1
  if (pending > 0) return
  console.log('FORK ' + JSON.stringify({ attempts, started, refused, pidsCurrent: pidsCurrent() }))
  for (const child of children) child.kill('SIGKILL')
}
for (let i = 0; i < attempts; i += 1) {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  children.push(child)
  child.once('spawn', () => { started += 1; settle() })
  child.once('error', () => { refused += 1; settle() })
}
`

/** Hold `mebibytes` of touched memory, then say how much it held. */
const BALLOON = `const held = []
for (let i = 0; i < Number(process.argv[2]); i += 1) held.push(Buffer.alloc(1024 * 1024, 1))
console.log('BALLOON allocated ' + String(held.length))
`

/**
 * The scripted model. It answers from what each request already holds, not
 * from call order: the shipped `session-title-llm` row asks the same route
 * for a title, so an ordered script would hand one of the two commands to the
 * title request instead of the agent. A request that offers no `bash` tool
 * gets text; otherwise the next command whose result the conversation does
 * not hold yet, then `done`.
 */
class CeilingProbeModel extends MockAdapter {
  private readonly node: string

  constructor(node: string) {
    super([])
    this.node = node
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.answer(options)
  }

  private answer(options: GenerateOptions): StreamChunk[] {
    if (!(options.tools ?? []).some(tool => tool.name === 'bash')) return textResponse('world ceiling probe')
    const answered = new Set([...JSON.stringify(options.messages).matchAll(/"toolCallId":"([^"]+)"/gu)].map(match => match[1]))
    if (!answered.has('fork-bomb')) {
      return toolCallResponse('fork-bomb', 'bash', { command: `${this.node} fork-bomb.cjs ${String(FORK_ATTEMPTS)}`, description: 'fork bomb' })
    }
    if (!answered.has('balloon')) {
      return toolCallResponse('balloon', 'bash', { command: `${this.node} balloon.cjs ${String(BALLOON_MEBIBYTES)}`, description: 'memory balloon' })
    }
    return textResponse('done')
  }
}

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('p3-10 world ceiling driver requires an overlay path')

await writeFile(join(process.cwd(), 'fork-bomb.cjs'), FORK_BOMB)
await writeFile(join(process.cwd(), 'balloon.cjs'), BALLOON)

const ctx = await bootProductionProfile({
  binName: 'p3-10-world-ceiling',
  profile: 'headless',
  overlayPaths: [
    fileURLToPath(new URL('./base.patch.yml', import.meta.url)),
    resolveConfigPath(overlayPath, undefined),
  ],
})
try {
  const node = JSON.stringify(process.execPath)
  ctx.llm.registerAdapter(['p3-10-mock'], new CeilingProbeModel(node))
  await createFixtureRootAgent(ctx, { provider: 'p3-10-mock', model: 'p3-10-mock', cwd: process.cwd() })
  await runFixtureTurn(ctx, { task: 'run the fork bomb, then the memory balloon' })
} finally {
  await ctx.fiber.dispose()
}
