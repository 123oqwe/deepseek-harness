import { randomUUID } from 'node:crypto'
import type { ExecutionWorld, WorldKind, WorldState, WorldPolicy } from './types.ts'

const worlds = new Map<string, ExecutionWorld>()

const ALLOWED: Record<WorldState, WorldState[]> = {
  uninitialized: ['created'],
  created: ['running', 'destroyed'],
  running: ['frozen', 'destroyed'],
  frozen: ['running', 'destroyed'],
  destroyed: [],
}

export function createWorld(kind: WorldKind, policy: WorldPolicy): ExecutionWorld {
  const world: ExecutionWorld = {
    id: randomUUID(),
    kind,
    state: 'created',
    policy,
    createdAt: new Date().toISOString(),
  }
  worlds.set(world.id, world)
  return world
}

export function transition(worldId: string, to: WorldState): ExecutionWorld {
  const world = worlds.get(worldId)
  if (!world) throw new Error(`World not found: ${worldId}`)
  // eslint-disable-next-line no-unnecessary-condition
  if (!ALLOWED[world.state]?.includes(to)) {
    throw new Error(`Invalid world transition: ${world.state} -> ${to}`)
  }
  const updated = { ...world, state: to }
  worlds.set(worldId, updated)
  return updated
}

export function getWorld(id: string): ExecutionWorld | undefined {
  return worlds.get(id)
}

export function destroyWorld(id: string): void {
  const world = worlds.get(id)
  if (!world) return
  worlds.set(id, { ...world, state: 'destroyed' })
}

export function clearWorlds(): void {
  worlds.clear()
}
