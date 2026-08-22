export type { Attestation } from './attestation.ts'
export { createAttestation, verifyAttestation, computeImageDigest } from './attestation.ts'
export type { RemoteWorldState, RemoteWorld } from './client.ts'
export { createRemote, attach, heartbeat, snapshot, terminate, getRemote, clearRemotes } from './client.ts'
