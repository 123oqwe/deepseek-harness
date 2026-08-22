 /**
 * Type definitions for Shadow/Enforce Feature Gates.
 *
 * @module @deepseek-ai/dsh-feature-gates/types
 */

 /** Gate state: off, shadow (observe only), or enforce (active). */
 export type GateState = 'off' | 'shadow' | 'enforce'

 /** A feature gate definition. */
 export interface FeatureGate {
   /** Unique gate identifier. */
   readonly id: string
   /** Human-readable description. */
   readonly description: string
   /** Team or individual responsible for this gate. */
   readonly owner: string
   /** Version that introduced this gate. */
   readonly introducedVersion: string
   /** Version after which this gate must be removed. */
   readonly removalVersion: string
   /** Default state per profile name. */
   readonly defaultByProfile: Record<string, GateState>
 }

 /** A resolved gate state with its source chain. */
 export interface ResolvedGate {
   readonly id: string
   readonly state: GateState
   readonly source: string
   readonly overrideChain: string[]
 }

 /** A shadow comparison event recording the difference between legacy and new behavior. */
 export interface ShadowEvent {
   readonly gateId: string
   readonly timestamp: string
   readonly legacyResult: unknown
   readonly shadowResult: unknown
   readonly equal: boolean
   readonly redactedPayload: string
 }

 /** Error thrown when an expired gate is found. */
 export class ExpiredGateError extends Error {
   readonly gateId: string
   readonly removalVersion: string
   constructor(gateId: string, removalVersion: string, currentVersion: string) {
     super(`Feature gate '${gateId}' expired: removalVersion ${removalVersion} <= current ${currentVersion}`)
     this.name = 'ExpiredGateError'
     this.gateId = gateId
     this.removalVersion = removalVersion
   }
 }

 /** Error thrown when a non-kernel principal tries to downgrade an enforce gate. */
 export class GateDowngradeError extends Error {
   readonly gateId: string
   readonly attemptedState: GateState
   constructor(gateId: string, attemptedState: GateState) {
     super(`Cannot downgrade gate '${gateId}' to '${attemptedState}' without kernel admin permission`)
     this.name = 'GateDowngradeError'
     this.gateId = gateId
     this.attemptedState = attemptedState
   }
 }
