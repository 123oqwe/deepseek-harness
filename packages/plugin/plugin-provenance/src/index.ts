 /**
  * Plugin provenance: signature, source, and SBOM verification.
  *
  * @module @deepseek-ai/dsh-plugin-provenance
  */

 export type { SignatureResult } from './signature.ts'
 export { registerTrustedRoot, clearTrustedRoots, verifySignature, computeDigest } from './signature.ts'
 export type { SBOMEntry, SBOM } from './sbom.ts'
 export { generateSBOM, verifySBOM } from './sbom.ts'
