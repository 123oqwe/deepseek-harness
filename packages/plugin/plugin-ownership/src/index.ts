import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PluginIdentity, NamespaceRegistration, OwnershipConflict } from './types.ts'
import { NamespaceConflictError } from './types.ts'

export type { Namespace, OwnershipToken, PluginIdentity, NamespaceRegistration, OwnershipConflict } from './types.ts'
export { NamespaceConflictError } from './types.ts'

const registrations: NamespaceRegistration[] = []
const officialNamespaces = new Set<string>(['dsh', 'deepseek', 'cordis', 'kernel'])

function asOwnershipToken(s: string): Branded<'OwnershipToken'> {
  return s as Branded<'OwnershipToken'>
}

export function registerNamespace(reg: Omit<NamespaceRegistration, 'ownershipToken'> & { ownershipToken?: string }): NamespaceRegistration {
  const fullReg: NamespaceRegistration = {
    ...reg,
    ownershipToken: (reg.ownershipToken ? asOwnershipToken(reg.ownershipToken) : asOwnershipToken(crypto.randomUUID())) as any,
  }
  registrations.push(fullReg)
  return fullReg
}

export function checkConflicts(): OwnershipConflict[] {
  const conflicts: OwnershipConflict[] = []
  const namespaceMap = new Map<string, NamespaceRegistration>()

  for (const reg of registrations) {
    const existing = namespaceMap.get(reg.namespace)
    if (existing) {
      if (existing.namespace === reg.namespace) {
        conflicts.push({
          type: 'namespace_collision',
          namespace: reg.namespace,
          existingPlugin: existing.pluginId,
          conflictingPlugin: reg.pluginId,
          message: `Namespace '${reg.namespace}' already owned by '${existing.pluginId}'`,
        })
      }
    } else {
      namespaceMap.set(reg.namespace, reg)
    }

    if (officialNamespaces.has(reg.namespace) && !reg.isOfficial) {
      conflicts.push({
        type: 'unauthorized_official',
        namespace: reg.namespace,
        existingPlugin: 'official',
        conflictingPlugin: reg.pluginId,
        message: `Namespace '${reg.namespace}' is reserved for official use`,
      })
    }
  }

  return conflicts
}

export function assertNoConflicts(): void {
  const conflicts = checkConflicts()
  if (conflicts.length > 0) {
    throw new NamespaceConflictError(conflicts)
  }
}

export function clearRegistrations(): void {
  registrations.length = 0
}

export function listRegistrations(): NamespaceRegistration[] {
  return [...registrations]
}

export function isOfficialNamespace(ns: string): boolean {
  return officialNamespaces.has(ns)
}

export function addOfficialNamespace(ns: string): void {
  officialNamespaces.add(ns)
}
