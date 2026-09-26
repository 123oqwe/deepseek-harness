/**
 * BLOCKED-336: plugin warnings and errors reach stderr, prefixed `dsh: `, and
 * never stdout. A host route takes the lines while it is registered, and a
 * route that throws hands the line back to stderr rather than losing it.
 */
import { Context } from '@deepseek-ai/cordis'
import type { LoggerType } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoggerStderr, { LINE_PREFIX } from '../src/index.ts'

/**
 * Mount the plugin on a fresh root and capture what reaches stderr and stdout.
 * @param types - the message types to write.
 * @returns the root context, the mounted plugin's fiber, and the two captures.
 */
async function mount(types: LoggerType[]) {
  const stderr: string[] = []
  const stdout: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  const ctx = new Context()
  const fiber = ctx.plugin(LoggerStderr, { types })
  await fiber
  return { ctx, fiber, stderr, stdout }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BLOCKED-336: plugin warnings and errors on stderr', () => {
  it('writes warn and error lines to stderr with the prefix, and nothing to stdout', async () => {
    const { ctx, stderr, stdout } = await mount(['error', 'warn'])
    const logger = ctx.logger('probe')
    logger.warn('careful here')
    logger.error('broken there')
    logger.info('fine')
    logger.debug('noise')

    expect(stderr).toHaveLength(2)
    expect(stderr.every(line => line.startsWith(LINE_PREFIX) && line.endsWith('\n'))).toBe(true)
    expect(stderr[0]).toContain('careful here')
    expect(stderr[1]).toContain('broken there')
    expect(stdout).toEqual([])
  })

  it('prefixes every line of a message that spans several', async () => {
    const { ctx, stderr } = await mount(['error'])
    ctx.logger('probe').error('first line\nsecond line')

    expect(stderr).toHaveLength(2)
    expect(stderr.every(line => line.startsWith(LINE_PREFIX))).toBe(true)
    expect(stderr[1]).toContain('second line')
  })

  it('writes only the configured types, and nothing when none is configured', async () => {
    const { ctx, stderr } = await mount(['info'])
    ctx.logger('probe').info('told')
    ctx.logger('probe').warn('not asked for')
    ctx.logger('probe').error('not asked for either')
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain('told')

    vi.restoreAllMocks()
    const silent = await mount([])
    silent.ctx.logger('probe').error('dropped')
    expect(silent.stderr).toEqual([])
  })

  it('writes what was logged before it mounted, once, when it mounts', async () => {
    const stderr: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk))
      return true
    })
    // The default @deepseek-ai/dsh-app-boot mounts the tree under, so the buffer keeps warnings.
    const ctx = new Context().intercept('logger', { level: 2 })
    ctx.logger('early').warn('early warning')
    ctx.logger('early').info('early information')
    await ctx.plugin(LoggerStderr, { types: ['error', 'warn'] })
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain('early warning')

    ctx.logger('late').warn('late warning')
    expect(stderr).toHaveLength(2)
    expect(stderr[1]).toContain('late warning')
  })

  it('defaults to warn and error', () => {
    expect(LoggerStderr.Config({})).toEqual({ types: ['error', 'warn'] })
  })

  it('stops writing once the plugin is unloaded', async () => {
    const { ctx, fiber, stderr } = await mount(['error'])
    await fiber.dispose()
    ctx.logger('probe').error('after unload')

    expect(stderr).toEqual([])
  })

  it('leaves an exporter registered after it running when it is unloaded (vendor/README.md modification 22)', async () => {
    const { ctx, fiber, stderr } = await mount(['error'])
    const later: string[] = []
    ctx.logger.exporter({ export: (message) => { later.push(String(message.args[0])) } })
    await fiber.dispose()
    ctx.logger('probe').error('after unload')

    expect(stderr).toEqual([])
    expect(later).toEqual(['after unload'])
  })
})

describe('BLOCKED-336: a host route takes the lines', () => {
  it('routes lines through the registered writer until its disposer runs', async () => {
    const { ctx, stderr } = await mount(['warn'])
    const routed: string[] = []
    const dispose = ctx.loggerStderr.routeThrough((line) => { routed.push(line) })
    ctx.logger('probe').warn('routed')
    dispose()
    ctx.logger('probe').warn('direct')

    expect(routed).toHaveLength(1)
    expect(routed[0]).toContain('routed')
    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toContain('direct')
  })

  it('lets a disposer clear only the route it installed', async () => {
    const { ctx } = await mount(['warn'])
    const first: string[] = []
    const second: string[] = []
    const disposeFirst = ctx.loggerStderr.routeThrough((line) => { first.push(line) })
    ctx.loggerStderr.routeThrough((line) => { second.push(line) })
    disposeFirst()
    ctx.logger('probe').warn('to the second')

    expect(first).toEqual([])
    expect(second).toHaveLength(1)
  })

  it('writes the line to stderr when the route throws, so nothing is lost', async () => {
    const { ctx, stderr } = await mount(['warn'])
    ctx.loggerStderr.routeThrough(() => { throw new Error('route broke') })
    ctx.logger('probe').warn('kept anyway')

    expect(stderr).toHaveLength(1)
    expect(stderr[0]).toMatch(new RegExp(`^${LINE_PREFIX}.*kept anyway`, 'u'))
  })
})
