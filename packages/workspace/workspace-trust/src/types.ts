 /**
  * Workspace trust boundary types.
  *
  * @module @deepseek-ai/dsh-workspace-trust/types
  */

 import type { Branded } from '@deepseek-ai/dsh-brand'

 /** Workspace trust state. */
 export type WorkspaceTrustState = 'untrusted' | 'trusted-read' | 'trusted-execute'

 /** A canonical workspace path identity. */
 export interface WorkspaceIdentity {
   readonly canonicalPath: string
   readonly trustState: WorkspaceTrustState
   readonly inode?: number
   readonly volumeId?: string
 }

 /** What is allowed in each trust state. */
 export interface TrustPolicy {
   readonly allowProjectPlugins: boolean
   readonly allowHooks: boolean
   readonly allowMCPServers: boolean
   readonly allowExecutableSkills: boolean
   readonly allowProfilePatchOverrides: boolean
   readonly allowSafeRead: boolean
 }

 /** Error thrown when untrusted workspace attempts restricted action. */
 export class WorkspaceTrustError extends Error {
   readonly action: string
   readonly workspacePath: string
   constructor(action: string, workspacePath: string) {
     super(`Workspace trust violation: '${action}' not allowed in untrusted workspace '${workspacePath}'`)
     this.name = 'WorkspaceTrustError'
     this.action = action
     this.workspacePath = workspacePath
   }
 }
