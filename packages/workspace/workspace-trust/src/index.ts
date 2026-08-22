 /**
  * Workspace trust boundary: untrusted directories do not load project-level execution content.
  *
  * @module @deepseek-ai/dsh-workspace-trust
  */

 import { realpathSync, statSync } from 'node:fs'
 import { resolve } from 'node:path'
 import type { WorkspaceTrustState, WorkspaceIdentity, TrustPolicy } from './types.ts'
 import { WorkspaceTrustError } from './types.ts'

 export type { WorkspaceTrustState, WorkspaceIdentity, TrustPolicy } from './types.ts'
 export { WorkspaceTrustError } from './types.ts'

 /** Trust state registry: canonical path -> WorkspaceIdentity. */
 const trustRegistry = new Map<string, WorkspaceIdentity>()

 /** Default trust policy per state. */
 const POLICIES: Record<WorkspaceTrustState, TrustPolicy> = {
   untrusted: {
     allowProjectPlugins: false,
     allowHooks: false,
     allowMCPServers: false,
     allowExecutableSkills: false,
     allowProfilePatchOverrides: false,
     allowSafeRead: true,
   },
   'trusted-read': {
     allowProjectPlugins: false,
     allowHooks: false,
     allowMCPServers: false,
     allowExecutableSkills: false,
     allowProfilePatchOverrides: false,
     allowSafeRead: true,
   },
   'trusted-execute': {
     allowProjectPlugins: true,
     allowHooks: true,
     allowMCPServers: true,
     allowExecutableSkills: true,
     allowProfilePatchOverrides: true,
     allowSafeRead: true,
   },
 }

 /** Resolve a workspace path to its canonical form. */
 export function resolveWorkspace(path: string): string {
   try {
     return realpathSync(resolve(path))
   } catch {
     return resolve(path)
   }
 }

 /** Get or create workspace identity for a path. */
 export function getOrCreateWorkspace(path: string, defaultState: WorkspaceTrustState = 'untrusted'): WorkspaceIdentity {
   const canonical = resolveWorkspace(path)
   const existing = trustRegistry.get(canonical)
   if (existing) return existing

   let inode: number | undefined
   let volumeId: string | undefined
   try {
     const stat = statSync(canonical)
     inode = stat.ino
     volumeId = stat.dev.toString()
   } catch {
     // Path doesn't exist; use canonical path as identity
   }

   const identity: WorkspaceIdentity = { canonicalPath: canonical, trustState: defaultState, inode, volumeId }
   trustRegistry.set(canonical, identity)
   return identity
 }

 /** Set the trust state for a workspace. */
 export function setTrustState(path: string, state: WorkspaceTrustState): void {
   const canonical = resolveWorkspace(path)
   const identity = getOrCreateWorkspace(path)
   trustRegistry.set(canonical, { ...identity, trustState: state })
 }

 /** Get the trust policy for a workspace. */
 export function getTrustPolicy(path: string): TrustPolicy {
   const identity = getOrCreateWorkspace(path)
   return POLICIES[identity.trustState]
 }

 /** Assert that an action is allowed in the workspace's trust state. */
 export function assertAllowed(path: string, action: keyof TrustPolicy): void {
   const policy = getTrustPolicy(path)
   if (!policy[action]) {
     throw new WorkspaceTrustError(action, resolveWorkspace(path))
   }
 }

 /** Check if an action is allowed. */
 export function isAllowed(path: string, action: keyof TrustPolicy): boolean {
   return getTrustPolicy(path)[action]
 }

 /** Clear all trust state. For testing. */
 export function clearTrust(): void {
   trustRegistry.clear()
 }
