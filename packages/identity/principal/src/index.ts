 /**
  * Unified Principal, Tenant, Run, and Actor identity context.
  *
  * @module @deepseek-ai/dsh-principal
  */

 export type {
   TenantId,
   RunId,
   PrincipalKind,
   UserPrincipal,
   ServicePrincipal,
   AgentPrincipal,
   AnonymousDevPrincipal,
   Principal,
   DelegationEntry,
   DelegationChain,
   IdentityContext,
 } from './types.ts'

 export {
   TenantBoundaryError,
   ForgedAgentIdError,
   ReplayedTokenError,
 } from './types.ts'

 export {
   createChain,
   extendChain,
   verifyInChain,
   assertAgentInChain,
   useToken,
   isTokenUsed,
   clearTokens,
   sameTenant,
   assertTenant,
   delegationDepth,
   isAnonymousDev,
   isAdmin,
   asTenantId,
 } from './chain.ts'
