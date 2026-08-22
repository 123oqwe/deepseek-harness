 /**
  * Unified identity types for Principal, Tenant, Run, and Actor context.
  *
  * Every event, tool, subagent, approval, and external action has an
  * unambiguous responsible principal and tenant boundary.
  *
  * @module @deepseek-ai/dsh-principal/types
  */

 import type { Branded } from '@deepseek-ai/dsh-brand'

 /** A tenant identifier. */
 export type TenantId = Branded<'TenantId'>

 /** A run identifier. */
 export type RunId = Branded<'RunId'>

 /** Principal kind: user, service, agent, or anonymous-dev. */
 export type PrincipalKind = 'user' | 'service' | 'agent' | 'anonymous-dev'

 /** A user principal: a real human user. */
 export interface UserPrincipal {
   readonly kind: 'user'
   readonly id: string
   readonly tenantId: TenantId
   readonly runId?: RunId
 }

 /** A service principal: a non-human system account. */
 export interface ServicePrincipal {
   readonly kind: 'service'
   readonly id: string
   readonly tenantId: TenantId
   readonly runId?: RunId
 }

 /** An agent principal: a delegated sub-agent with a chain. */
 export interface AgentPrincipal {
   readonly kind: 'agent'
   readonly id: string
   readonly tenantId: TenantId
   readonly runId: RunId
   readonly delegatedBy: string
   readonly delegationDepth: number
 }

 /** An anonymous development principal: restricted, not equivalent to admin. */
 export interface AnonymousDevPrincipal {
   readonly kind: 'anonymous-dev'
   readonly id: string
   readonly tenantId: TenantId
   readonly runId?: RunId
 }

 /** A principal: one of the four kinds. */
   export type Principal = UserPrincipal | ServicePrincipal | AgentPrincipal | AnonymousDevPrincipal

 /** A delegation chain entry. */
 export interface DelegationEntry {
   readonly principalId: string
   readonly kind: PrincipalKind
   readonly delegatedAt: string
   readonly reason?: string
 }

 /** A complete delegation chain from root to current actor. */
   export interface DelegationChain {
   readonly entries: DelegationEntry[]
   readonly rootPrincipalId: string
   readonly rootTenantId: TenantId
   readonly currentPrincipalId: string
   readonly currentTenantId: TenantId
 }

 /** Identity context attached to every event, tool, and action. */
   export interface IdentityContext {
   readonly principal: Principal
   readonly runId: RunId
   readonly delegationChain: DelegationChain
 }

 /** Error thrown when a tenant boundary is violated. */
   export class TenantBoundaryError extends Error {
   readonly attemptedTenant: string
   readonly actualTenant: string
   constructor(attempted: string, actual: string) {
     super(`Tenant boundary violation: attempted '${attempted}', actual '${actual}'`)
     this.name = 'TenantBoundaryError'
     this.attemptedTenant = attempted
     this.actualTenant = actual
   }
 }

 /** Error thrown when a forged agent ID is detected. */
   export class ForgedAgentIdError extends Error {
   constructor(agentId: string) {
     super(`Forged agent ID detected: '${agentId}' does not appear in delegation chain`)
     this.name = 'ForgedAgentIdError'
   }
 }

 /** Error thrown when a replayed token is detected. */
   export class ReplayedTokenError extends Error {
   constructor(tokenId: string) {
     super(`Replayed token detected: '${tokenId}' has already been used`)
     this.name = 'ReplayedTokenError'
   }
 }
