/**
 * Driver for lane B's P3-12 must[2] red first (slice A, the isolated decode): on
 * the SHIPPED headless profile, an untrusted image admitted through
 * `ctx.attachments.admitPromptContent` is decoded in another process, and a
 * crash of that process does not take the host down.
 *
 * It boots headless through `bootProductionProfile` with the overlay beside it
 * and pins the Trust Kernel, then admits two generated PNGs while it polls this
 * process's descendants with `ps`. The first admission only watches; during the
 * second, every descendant seen is killed with SIGKILL as soon as it appears. It
 * prints one `P3-12-A-DECODE <json>` line; reaching that line is the host
 * surviving. A worker thread shares this process and is never a descendant.
 * @module tests/first100/fixtures/loader/p3-12-a-isolated-decode/driver
 */

import { spawnSync } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-attachment'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { REPORT_PREFIX, type AdmissionReading, type DecodeReport } from './shared.ts'

/** The generated images' side, in pixels: inside the shipped limits, large enough that decoding takes a while. */
const SIDE = 1600
/** How long one admission may take before the run reports it unsettled. */
const SETTLE_MS = 60_000

/**
 * A truecolour PNG whose pixels depend on `seed`, so two calls never share bytes.
 * @param seed - varies the pixels.
 * @returns the PNG bytes.
 */
function png(seed: number): Buffer {
  const stride = SIDE * 3 + 1
  const raw = Buffer.alloc(stride * SIDE)
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      const at = y * stride + 1 + x * 3
      raw[at] = (x + seed) & 0xff
      raw[at + 1] = (y * 3) & 0xff
      raw[at + 2] = (x ^ y ^ seed) & 0xff
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIDE, 0)
  header.writeUInt32BE(SIDE, 4)
  header[8] = 8
  header[9] = 2
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/**
 * Every descendant of `root`, read from one `ps` listing (the listing process itself excluded).
 * @param root - the process whose descendants are wanted.
 * @returns their pids.
 */
function descendants(root: number): number[] {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  const children = new Map<number, number[]>()
  for (const line of listed.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/u).map(Number)
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) continue
    children.set(ppid, [...children.get(ppid) ?? [], pid])
  }
  const found: number[] = []
  const queue = [...children.get(root) ?? []]
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    if (pid === listed.pid) continue
    found.push(pid)
    queue.push(...children.get(pid) ?? [])
  }
  return found
}

/**
 * Admit one image while polling this process's descendants, killing each one seen when `kill` holds.
 * @param ctx - the booted profile.
 * @param image - the PNG bytes.
 * @param kill - whether to SIGKILL every descendant as soon as it is seen.
 * @returns what the admission showed.
 */
async function admitWatching(ctx: Context, image: Buffer, kill: boolean): Promise<AdmissionReading> {
  const seen = new Set<number>()
  const killed = new Set<number>()
  const poll = (): void => {
    for (const pid of descendants(process.pid)) {
      seen.add(pid)
      if (!kill || killed.has(pid)) continue
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already exited between the listing and the signal: nothing is left to kill.
        continue
      }
      killed.add(pid)
    }
  }
  const timer = setInterval(poll, 5)
  poll()
  let settle: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    settle = setTimeout(() => { reject(new Error(`admission did not settle within ${String(SETTLE_MS)} ms`)) }, SETTLE_MS)
  })
  let outcome: string
  try {
    const admitted = await Promise.race([
      ctx.attachments.admitPromptContent([{ type: 'image', mediaType: 'image/png', data: image.toString('base64') }]),
      deadline,
    ])
    outcome = admitted.some(part => part.type === 'image') ? 'admitted' : 'no image reference'
  } catch (error: unknown) {
    outcome = `refused: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    clearInterval(timer)
    clearTimeout(settle)
  }
  return { seen: [...seen], killed: [...killed], outcome: outcome.slice(0, 400) }
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p3-12-a driver requires a config path')

const ctx: Context = await bootProductionProfile({
  binName: 'p3-12-a-isolated-decode',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  const before = descendants(process.pid)
  const watched = await admitWatching(ctx, png(1), false)
  const crashed = await admitWatching(ctx, png(2), true)
  const report: DecodeReport = { hostPid: process.pid, before, watched, crashed }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
