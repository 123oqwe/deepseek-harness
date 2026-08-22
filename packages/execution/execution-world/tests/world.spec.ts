import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, transition, getWorld, destroyWorld, clearWorlds } from '../src/index.ts'

const policy = {
  fs: { read: ['/workspace'], write: ['/workspace/out'] },
  net: { allowDestinations: ['api.example.com'] },
  proc: { allowCommands: ['node'], allowShell: false },
  ipc: { allowNamespaces: [] },
  device: { allowDevices: [] },
}

describe('P3-01 ExecutionWorld', () => {
  beforeEach(() =>{  clearWorlds(); })
  afterEach(() =>{  clearWorlds(); })

  it('creates a world', () => {
    const world = createWorld('local', policy)
    expect(world.state).toBe('created')
    expect(world.kind).toBe('local')
    expect(world.policy.fs.read).toContain('/workspace')
  })

  it('transitions created -> running -> frozen -> running', () => {
    const world = createWorld('local', policy)
    const running = transition(world.id, 'running')
    expect(running.state).toBe('running')
    const frozen = transition(world.id, 'frozen')
    expect(frozen.state).toBe('frozen')
    const resumed = transition(world.id, 'running')
    expect(resumed.state).toBe('running')
  })

  it('rejects invalid transition', () => {
    const world = createWorld('local', policy)
    expect(() => transition(world.id, 'frozen')).toThrow('Invalid')
  })

  it('destroys a world', () => {
    const world = createWorld('local', policy)
    destroyWorld(world.id)
    const destroyed = getWorld(world.id)
    expect(destroyed!.state).toBe('destroyed')
  })

  it('destroyed world cannot transition', () => {
    const world = createWorld('local', policy)
    destroyWorld(world.id)
    expect(() => transition(world.id, 'running')).toThrow('Invalid')
  })
})
