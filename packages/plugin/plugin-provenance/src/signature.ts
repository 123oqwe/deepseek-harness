 /**
  * Plugin signature verification.
  *
  * @module @deepseek-ai/dsh-plugin-provenance/signature
  */

 import { createHash, createVerify } from 'node:crypto'

 /** A verified signature result. */
 export interface SignatureResult {
   readonly valid: boolean
   readonly keyId?: string
   readonly signer?: string
   readonly reason: string
 }

 /** Trusted root keys for verification. */
 const trustedRoots = new Map<string, { publicKey: string; owner: string }>()

 /** Register a trusted root key. */
 export function registerTrustedRoot(keyId: string, publicKey: string, owner: string): void {
   trustedRoots.set(keyId, { publicKey, owner })
 }

 /** Clear all trusted roots. For testing. */
 export function clearTrustedRoots(): void {
   trustedRoots.clear()
 }

 /** Verify a plugin signature. */
 export function verifySignature(
   data: Uint8Array,
   signature: Uint8Array,
   keyId: string,
   algorithm: string = 'sha256',
 ): SignatureResult {
   const root = trustedRoots.get(keyId)
   if (!root) {
     return { valid: false, reason: `unknown key id: ${keyId}` }
   }
   try {
     const verifier = createVerify(algorithm)
     verifier.update(data)
     const isValid = verifier.verify(root.publicKey, signature)
     return { valid: isValid, keyId, signer: root.owner, reason: isValid ? 'verified by trusted root' : 'signature does not match' }
   } catch (e) {
     return { valid: false, keyId, reason: `verification error: ${(e as Error).message}` }
   }
 }

 /** Compute a digest of plugin content. */
 export function computeDigest(data: Uint8Array): string {
   return createHash('sha256').update(data).digest('hex')
 }
