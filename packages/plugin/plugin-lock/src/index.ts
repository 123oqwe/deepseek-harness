import { createHash } from 'node:crypto'
import type { PluginLockFile, LockedDependency } from './types.ts'

export type { PluginLockFile, LockedDependency } from './types.ts'

export function generateLock(plugins: Array<{ name: string; version: string; dependencies: LockedDependency[] }>): PluginLockFile {
  const lockPlugins: Record<string, { version: string; dependencies: LockedDependency[] }> = {}
  for (const p of plugins) {
    lockPlugins[p.name] = { version: p.version, dependencies: p.dependencies }
  }
  return {
    version: 1,
    plugins: lockPlugins,
    generatedAt: new Date().toISOString(),
    hashAlgorithm: 'sha256',
  }
}

export function computeLockHash(lock: PluginLockFile): string {
  const obj = { version: lock.version, plugins: lock.plugins, hashAlgorithm: lock.hashAlgorithm }
  const canonical = JSON.stringify(obj, Object.keys(obj).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

export function verifyLockIntegrity(lock: PluginLockFile, expectedHash: string): boolean {
  return computeLockHash(lock) === expectedHash
}

export function resolvePlugin(lock: PluginLockFile, name: string): { version: string; dependencies: LockedDependency[] } | undefined {
  return lock.plugins[name]
}

export function detectDrift(lock1: PluginLockFile, lock2: PluginLockFile): string[] {
  const drifts: string[] = []
  for (const [name, entry1] of Object.entries(lock1.plugins)) {
    const entry2 = lock2.plugins[name]
    if (!entry2) {
      drifts.push(`Plugin '${name}' removed from lock`)
    } else if (entry1.version !== entry2.version) {
      drifts.push(`Plugin '${name}' version changed: ${entry1.version} -> ${entry2.version}`)
    }
  }
  for (const name of Object.keys(lock2.plugins)) {
    if (!lock1.plugins[name]) {
      drifts.push(`Plugin '${name}' added to lock`)
    }
  }
  return drifts
}
