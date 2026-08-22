 /**
  * Delegation chain management for identity context.
  *
  * @module @deepseek-ai/dsh-principal/chain
  */

 import type { Branded } from '@deepseek-ai/dsh-brand'
 import type { Principal, DelegationChain, DelegationEntry, TenantId } from './types.ts'
 import { TenantBoundaryError, ForgedAgentIdError, ReplayedTokenError } from './types.ts'

 /** Branded type constructor for TenantId. */
 function asTenantId(s: string): TenantId {
   return s as Branded<'TenantId'>
 }

 /** Track used tokens to detect replays. */
 const usedTokens = new Set<string>()

 /** Create a new delegation chain from a root principal. */
 export function createChain(rootPrincipal: Principal): DelegationChain {
   const entry: DelegationEntry = {
     principalId: rootPrincipal.id,
     kind: rootPrincipal.kind,
     delegatedAt: new Date().toISOString(),
   }
   return {
     entries: [entry],
     rootPrincipalId: rootPrincipal.id,
     rootTenantId: rootPrincipal.tenantId,
     currentPrincipalId: rootPrincipal.id,
     currentTenantId: rootPrincipal.tenantId,
   }
 }

 /** Extend a delegation chain by delegating to a new principal. */
 export function extendChain(
   chain: DelegationChain,
   delegatedPrincipal: Principal,
   reason?: string,
 ): DelegationChain {
   // Check tenant boundary: delegation must stay within the same tenant
   if (delegatedPrincipal.tenantId !== chain.currentTenantId) {
     throw new TenantBoundaryError(
       String(delegatedPrincipal.tenantId),
       String(chain.currentTenantId),
     )
   }

   const entry: DelegationEntry = {
     principalId: delegatedPrincipal.id,
     kind: delegatedPrincipal.kind,
     delegatedAt: new Date().toISOString(),
     reason,
   }

   return {
     entries: [...chain.entries, entry],
     rootPrincipalId: chain.rootPrincipalId,
     rootTenantId: chain.rootTenantId,
     currentPrincipalId: delegatedPrincipal.id,
     currentTenantId: delegatedPrincipal.tenantId,
   }
 }

 /** Verify that a principal appears in the delegation chain. */
 export function verifyInChain(chain: DelegationChain, principalId: string): boolean {
   return chain.entries.some(e => e.principalId === principalId)
 }

 /** Assert that an agent principal is in the delegation chain (not forged). */
 export function assertAgentInChain(chain: DelegationChain, agentId: string): void {
   if (!verifyInChain(chain, agentId)) {
     throw new ForgedAgentIdError(agentId)
   }
 }

 /** Mark a token as used; throw if already used (replay detection). */
 export function useToken(tokenId: string): void {
   if (usedTokens.has(tokenId)) {
     throw new ReplayedTokenError(tokenId)
   }
   usedTokens.add(tokenId)
 }

 /** Check if a token has been used. */
 export function isTokenUsed(tokenId: string): boolean {
   return usedTokens.has(tokenId)
 }

 /** Clear all used tokens. For testing. */
 export function clearTokens(): void {
   usedTokens.clear()
 }

 /** Check that two principals share the same tenant. */
 export function sameTenant(a: Principal, b: Principal): boolean {
   return a.tenantId === b.tenantId
 }

 /** Assert that a principal belongs to a specific tenant. */
 export function assertTenant(principal: Principal, expectedTenant: TenantId): void {
   if (principal.tenantId !== expectedTenant) {
     throw new TenantBoundaryError(
       String(principal.tenantId),
       String(expectedTenant),
     )
   }
 }

 /** Get the delegation depth of the current principal. */
 export function delegationDepth(chain: DelegationChain): number {
   return chain.entries.length - 1
 }

 /** Check if a principal is anonymous-dev (restricted, not admin). */
 export function isAnonymousDev(principal: Principal): boolean {
   return principal.kind === 'anonymous-dev'
 }

 /** Check if a principal has admin-level access (never anonymous-dev). */
 export function isAdmin(principal: Principal): boolean {
   return principal.kind !== 'anonymous-dev'
 }
 
 export { asTenantId }
