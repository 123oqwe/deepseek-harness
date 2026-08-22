import { randomUUID } from 'node:crypto'
import type { Attestation } from './attestation.ts'

export type RemoteWorldState = 'creating' | 'attaching' | 'running' | 'snapshot' | 'terminated' | 'disconnected'

export interface RemoteWorld {
  readonly id: string
  readonly state: RemoteWorldState
  readonly attestation?: Attestation
  readonly lastHeartbeat?: string
}

const worlds = new Map<string, RemoteWorld>()

export function createRemote(attestation?: Attestation): RemoteWorld {
  const world: RemoteWorld = { id: randomUUID(), state: 'creating', ...(attestation !== undefined && { attestation }) }
  worlds.set(world.id, world)
  return { ...world, state: 'running' }
}

export function attach(remoteId: string): RemoteWorld {
  const world = worlds.get(remoteId)
  if (!world) throw new Error(`Remote world not found: ${remoteId}`)
  return { ...world, state: 'attaching' }
}

export function heartbeat(remoteId: string): RemoteWorld {
  const world = worlds.get(remoteId)
  if (!world) throw new Error(`Remote world not found: ${remoteId}`)
  const updated = { ...world, lastHeartbeat: new Date().toISOString() }
  worlds.set(remoteId, updated)
  return updated
}

export function snapshot(remoteId: string): RemoteWorld {
  const world = worlds.get(remoteId)
  if (!world) throw new Error(`Remote world not found: ${remoteId}`)
  return { ...world, state: 'snapshot' }
}

export function terminate(remoteId: string): RemoteWorld {
  const world = worlds.get(remoteId)
  if (!world) throw new Error(`Remote world not found: ${remoteId}`)
  const terminated = { ...world, state: 'terminated' }
  worlds.set(remoteId, terminated)
  return terminated
}

export function getRemote(id: string): RemoteWorld | undefined {
  return worlds.get(id)
}

export function clearRemotes(): void {
  worlds.clear()
}
