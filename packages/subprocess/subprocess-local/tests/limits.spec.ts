/**
 * P3-10 R1 on the local provider: a spawn's ceilings become the user scope's
 * own properties, a machine that cannot hold them refuses the spawn, and the
 * answer to "what can this machine hold" is the provider's own.
 *
 * The hard-limit cases run only where the provider says it holds the
 * dimension -- the same containment selection its spawn makes, not the
 * platform name -- and say why when they skip. On CI's ubuntu runner that
 * selection is `linux-scope`, where `scope-limits-probe.spec.ts` ("user scope
 * on linux: control=accepted TasksMax=accepted/enforced/in-scope
 * MemoryMax=accepted/enforced/in-scope CPUQuota=accepted/enforced/in-scope")
 * observed that all three properties bite. Every attack here is bounded: a
 * finite number of children or bytes a little past the ceiling and a hard
 * deadline, so a mutant that drops a ceiling fails an assertion instead of
 * taking the runner down.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SubprocessLimitsRefusedError } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessLimitDimension, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { launchLinuxScope, scopeLimitProperties } from '../src/linux-scope.ts'

/** A spec running Node on `script`, collecting stdout for the case to read. */
function nodeSpec(script: string, overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: [process.execPath, '-e', script],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64_000 }, stderr: { maxBytes: 64_000 } },
    graceMs: 200,
    signal: AbortSignal.timeout(20_000),
    ...overrides,
  }
}

/** Every argument the scope launch hands `systemd-run`, captured by failing the launch at spawn. */
function scopeArguments(limits: SubprocessSpawnSpec['limits']): readonly string[] {
  let captured: readonly string[] = []
  expect(() => launchLinuxScope({ ...nodeSpec(''), argv: ['tool', 'literal arg'], limits }, {}, {
    spawn: ((_command: string, args: readonly string[]) => {
      captured = args
      throw new Error('captured')
    }) as never,
    runnerInvocation: ['/usr/bin/node', '/runner.js'],
  })).toThrow('captured')
  return captured
}

describe('P3-10 R1 — the scope carries a spawn\'s ceilings as its own properties', () => {
  it('spells each ceiling as the systemd property that holds it, and nothing for none', () => {
    expect(scopeLimitProperties(undefined)).toEqual([])
    expect(scopeLimitProperties({})).toEqual([])
    expect(scopeLimitProperties({ cpuMillicores: 250, memoryBytes: 67_108_864, maxProcesses: 32 })).toEqual([
      '-p', 'CPUQuota=25%',
      '-p', 'MemoryMax=67108864', '-p', 'MemorySwapMax=0',
      '-p', 'TasksMax=32',
    ])
  })

  it('launches exactly the argument list it launched before ceilings existed when the spawn names none', () => {
    const before = [
      '--user', '--scope', '--quiet', '--collect', '--expand-environment=no',
    ]
    const withoutLimits = scopeArguments(undefined)
    expect(withoutLimits.slice(0, 5)).toEqual(before)
    expect(withoutLimits[5]).toMatch(/^--unit=dsh-subprocess-/)
    expect(withoutLimits.slice(6)).toEqual(['--', '/usr/bin/node', '/runner.js', '--', 'tool', 'literal arg'])
    expect(scopeArguments({}).slice(6)).toEqual(withoutLimits.slice(6))
  })

  it('puts the properties before the command separator, where systemd-run reads its own options', () => {
    const args = scopeArguments({ maxProcesses: 8 })
    expect(args.slice(6, 9)).toEqual(['-p', 'TasksMax=8', '--'])
    expect(args.indexOf('-p')).toBeLessThan(args.indexOf('--'))
  })
})

describe('P3-10 R1 — a machine that cannot hold a ceiling refuses the spawn', () => {
  it('REFUSES a limited spawn on a platform with no native managed range, and launches nothing', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      ;(ctx.subprocess as LocalSubprocessRuntime).internals = { platform: 'aix' }
      expect(ctx.subprocess.enforceableLimits()).toEqual([])
      expect(() => ctx.subprocess.spawn(nodeSpec('process.exit(7)', { limits: { maxProcesses: 32 } })))
        .toThrow(SubprocessLimitsRefusedError)
      const unlimited = ctx.subprocess.spawn(nodeSpec('process.exit(7)'))
      await expect(unlimited.done).resolves.toEqual({ exitCode: 7, signal: null })
    } finally {
      await fiber.dispose()
    }
  })

  it('answers what this machine can hold from the same selection a spawn makes, and a spawn agrees with the answer', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const answer = ctx.subprocess.enforceableLimits()
      console.log(`[limits] platform=${process.platform} enforceable=${answer.join(',') || '(none)'}`)
      const limited = (): Promise<unknown> => ctx.subprocess.spawn(nodeSpec('', { limits: { maxProcesses: 64 } })).done
      if (answer.includes('processes')) await expect(limited()).resolves.toEqual({ exitCode: 0, signal: null })
      else expect(limited).toThrow(SubprocessLimitsRefusedError)
    } finally {
      await fiber.dispose()
    }
  })
})

describe('P3-10 R1 acceptance[0] — the ceilings bite, where this machine can hold them', () => {
  let ctx: Context
  let fiber: Fiber
  let enforceable: readonly SubprocessLimitDimension[] = []

  beforeAll(async () => {
    ctx = new Context()
    fiber = await ctx.plugin(LocalSubprocessRuntime)
    enforceable = ctx.subprocess.enforceableLimits()
  })

  afterAll(async () => {
    await fiber.dispose()
  })

  /** Skip, saying why, when the provider does not claim `dimension` on this machine. */
  function requireEnforceable(skip: (note: string) => void, dimension: SubprocessLimitDimension): void {
    if (enforceable.includes(dimension)) return
    const note = `this machine's provider holds [${enforceable.join(', ')}], not ${dimension} (platform ${process.platform})`
    console.log(`[limits] skipped: ${note}`)
    skip(note)
  }

  it('puts a named ceiling on the scope, and leaves a spawn that names none without it', async ({ skip }) => {
    requireEnforceable(skip, 'processes')
    requireEnforceable(skip, 'memory')
    // Read from inside the scope, as the runner probe reads it. A scope without
    // a ceiling may still carry the manager's own default TasksMax, so the
    // unlimited reading is compared with the limited one, not with `max`.
    // The scope's own path and its parent's controller files are recorded too:
    // which controllers the manager hands a scope is what a capability answer
    // has to be built on before a caller passes ceilings (lane B inbox B-463 ⑤).
    const readback = `
      const fs = require('node:fs')
      const read = file => { try { return fs.readFileSync(file, 'utf8').trim() } catch (error) { return 'unreadable: ' + error.code } }
      const self = fs.readFileSync('/proc/self/cgroup', 'utf8')
      const path = self.match(/^0::(.*)$/m)[1]
      const parent = path.slice(0, path.lastIndexOf('/'))
      console.log(JSON.stringify({
        pids: read('/sys/fs/cgroup' + path + '/pids.max'),
        memory: read('/sys/fs/cgroup' + path + '/memory.max'),
        cgroup: self.trim(),
        parentControllers: read('/sys/fs/cgroup' + parent + '/cgroup.controllers'),
        parentSubtreeControl: read('/sys/fs/cgroup' + parent + '/cgroup.subtree_control'),
      }))
    `
    type Readback = { pids: string; memory: string; cgroup: string; parentControllers: string; parentSubtreeControl: string }
    const read = async (limits: SubprocessSpawnSpec['limits']): Promise<Readback> => {
      const handle = ctx.subprocess.spawn(nodeSpec(readback, { limits }))
      await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
      return JSON.parse(handle.collected.stdout!.readFrom(0).text) as Readback
    }
    const limited = await read({ maxProcesses: 32, memoryBytes: 134_217_728 })
    const unlimited = await read(undefined)
    console.log(`[limits] limited=${JSON.stringify(limited)} unlimited=${JSON.stringify(unlimited)}`)
    expect({ pids: limited.pids, memory: limited.memory }).toEqual({ pids: '32', memory: '134217728' })
    expect(unlimited.pids).not.toBe('32')
    expect(unlimited.memory).toBe('max')
  })

  it('reads how many tasks a limited scope holds when its command is one sleep, which is the launch runner\'s share', async ({ skip }) => {
    requireEnforceable(skip, 'processes')
    // The shell prints its scope's path and then replaces itself with `sleep`,
    // so what the scope holds afterwards is the command plus whatever the
    // launch left behind. Read from this process while the command sleeps.
    const handle = ctx.subprocess.spawn({
      ...nodeSpec(''),
      argv: ['/bin/sh', '-c', 'sed -n "s/^0:://p" /proc/self/cgroup; exec sleep 10'],
      limits: { maxProcesses: 64 },
    })
    let path = ''
    for (let attempt = 0; attempt < 100 && !path.endsWith('\n'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      path = handle.collected.stdout!.readFrom(0).text
    }
    const { readFileSync } = await import('node:fs')
    const current = Number(readFileSync(`/sys/fs/cgroup${path.trim()}/pids.current`, 'utf8'))
    handle.terminate()
    await handle.waitForExit(AbortSignal.timeout(10_000))
    console.log(`[limits] tasks in a limited scope whose command is one sleep: pids.current=${String(current)} path=${path.trim()}`)
    expect(current).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('holds a fork bomb to its process ceiling, and nothing it started outlives the range', async ({ skip }) => {
    requireEnforceable(skip, 'processes')
    const ceiling = 32
    // 64 children is past the ceiling by more than Node's own threads; each is
    // a `sleep` the script kills once it has read the peak.
    const handle = ctx.subprocess.spawn(nodeSpec(`
      const { spawn } = require('node:child_process')
      const fs = require('node:fs')
      const path = fs.readFileSync('/proc/self/cgroup', 'utf8').match(/^0::(.*)$/m)[1]
      const children = []
      let started = 0, refused = 0, pending = 64
      const settle = () => {
        if (--pending > 0) return
        const current = Number(fs.readFileSync('/sys/fs/cgroup' + path + '/pids.current', 'utf8'))
        console.log(JSON.stringify({ path, started, refused, current }))
        for (const child of children) child.kill('SIGKILL')
      }
      for (let i = 0; i < 64; i++) {
        const child = spawn('sleep', ['30'], { stdio: 'ignore' })
        children.push(child)
        child.once('spawn', () => { started++; settle() })
        child.once('error', () => { refused++; settle() })
      }
    `, { limits: { maxProcesses: ceiling } }))
    await handle.done
    await expect(handle.waitForExit(AbortSignal.timeout(10_000))).resolves.toBe(true)
    type Reading = { path: string; started: number; refused: number; current: number }
    const reading = JSON.parse(handle.collected.stdout!.readFrom(0).text) as Reading
    console.log(`[limits] fork bomb under TasksMax=${String(ceiling)}: ${JSON.stringify(reading)}`)
    expect(reading.current).toBeLessThanOrEqual(ceiling)
    expect(reading.refused).toBeGreaterThan(0)
    expect(reading.started + reading.refused).toBe(64)
  }, 30_000)

  it('kills a memory balloon at its memory ceiling, while the same script under the ceiling runs to the end', async ({ skip }) => {
    requireEnforceable(skip, 'memory')
    const balloon = (mebibytes: number): string => `
      const held = []
      for (let i = 0; i < ${String(mebibytes)}; i++) held.push(Buffer.alloc(1024 * 1024, 1))
      console.log('allocated ' + held.length)
    `
    const limits = { memoryBytes: 128 * 1024 * 1024 }
    const control = ctx.subprocess.spawn(nodeSpec(balloon(16), { limits }))
    await expect(control.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(control.collected.stdout!.readFrom(0).text.trim()).toBe('allocated 16')

    const attack = ctx.subprocess.spawn(nodeSpec(balloon(512), { limits }))
    const outcome = await attack.done
    console.log(`[limits] balloon of 512 MiB under MemoryMax=128MiB: ${JSON.stringify(outcome)}`)
    expect(outcome).toEqual({ exitCode: null, signal: 'SIGKILL' })
    expect(attack.collected.stdout!.readFrom(0).text).not.toContain('allocated')
  }, 30_000)
})
