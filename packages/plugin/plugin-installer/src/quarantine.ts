import { createHash } from 'node:crypto'

export type QuarantineState = 'downloaded' | 'verified' | 'rejected' | 'installed' | 'rolled-back'

export interface QuarantineEntry {
  readonly pluginName: string
  readonly version: string
  readonly tarballDigest: string
  readonly manifestDigest?: string
  readonly signatureValid: boolean
  readonly sbomValid: boolean
  readonly pathTraversalDetected: boolean
  readonly lifecycleScriptsBlocked: boolean
  readonly state: QuarantineState
  readonly quarantinePath: string
  readonly installedAt?: string
  readonly rejectedReason?: string
}

export function createQuarantine(pluginName: string, version: string, tarballData: Uint8Array): QuarantineEntry {
  return {
    pluginName,
    version,
    tarballDigest: createHash('sha256').update(tarballData).digest('hex'),
    signatureValid: false,
    sbomValid: false,
    pathTraversalDetected: false,
    lifecycleScriptsBlocked: true,
    state: 'downloaded',
    quarantinePath: `/tmp/quarantine/${pluginName}-${version}`,
  }
}

export function verify(entry: QuarantineEntry, checks: { signature?: boolean; sbom?: boolean; pathTraversal?: boolean }): QuarantineEntry {
  const updated = {
    ...entry,
    signatureValid: checks.signature ?? entry.signatureValid,
    sbomValid: checks.sbom ?? entry.sbomValid,
    pathTraversalDetected: checks.pathTraversal ?? entry.pathTraversalDetected,
  }
  if (!updated.signatureValid) {
    return { ...updated, state: 'rejected', rejectedReason: 'signature verification failed' }
  }
  if (!updated.sbomValid) {
    return { ...updated, state: 'rejected', rejectedReason: 'SBOM verification failed' }
  }
  if (updated.pathTraversalDetected) {
    return { ...updated, state: 'rejected', rejectedReason: 'path traversal detected' }
  }
  return { ...updated, state: 'verified' }
}

export function install(entry: QuarantineEntry): QuarantineEntry {
  if (entry.state !== 'verified') {
    throw new Error(`Cannot install: entry is ${entry.state}`)
  }
  return { ...entry, state: 'installed', installedAt: new Date().toISOString() }
}

export function rollback(entry: QuarantineEntry): QuarantineEntry {
  return { ...entry, state: 'rolled-back' }
}
