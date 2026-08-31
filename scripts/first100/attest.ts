/**
 * Ed25519 detached attestation for First-100 observations (R0-4, decision
 * package §5.2 rule 1).
 *
 * The private key is NEVER committed: it lives in the local keyring at
 * `~/.config/dsh-first100/first100-signing.key` (0600) or is injected as
 * `DSH_FIRST100_SIGNING_KEY` (base64 PKCS8 PEM). The public identity is pinned
 * and committed at `tests/first100/trusted-identity.json`. Signing covers the
 * canonical serialization (sorted keys, signature field stripped) so a
 * verifier can re-derive the same bytes and check them against the pinned key.
 */
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { loadPinnedIdentity, resolveRepoRoot } from './common.ts'

/** Canonical JSON: sorted object keys, compact — stable input for signing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

/** The evidence object minus its attestation field (the canonical input to sign). */
export function evidenceWithoutSignature(observation: Record<string, unknown>): Record<string, unknown> {
  const { signature: _signature, ...rest } = observation
  return rest
}

/** Sign a payload with an Ed25519 private key PEM; returns a hex signature. */
export function signBytes(privateKeyPem: string, payload: Buffer): string {
  return sign(null, payload, privateKeyPem).toString('hex')
}

/** Verify a hex Ed25519 signature over a payload against a public key PEM. */
export function verifyBytes(publicKeyPem: string, payload: Buffer, signatureHex: string): boolean {
  const sig = Buffer.from(signatureHex, 'hex')
  if (sig.length === 0) return false
  try {
    return verify(null, payload, publicKeyPem, sig)
  } catch {
    return false
  }
}

/** Sign an observation object: canonical JSON minus signature, then Ed25519. */
export function signObservation(privateKeyPem: string, observation: Record<string, unknown>): string {
  const canonical = canonicalJson(evidenceWithoutSignature(observation))
  return signBytes(privateKeyPem, Buffer.from(canonical, 'utf8'))
}

/** Verify an observation's signature against a public key PEM. */
export function verifyObservationSignature(publicKeyPem: string, observation: Record<string, unknown>): boolean {
  const signatureHex = typeof observation.signature === 'string' ? observation.signature : ''
  const canonical = canonicalJson(evidenceWithoutSignature(observation))
  return verifyBytes(publicKeyPem, Buffer.from(canonical, 'utf8'), signatureHex)
}

export interface SigningIdentity {
  privateKeyPem: string
  publicKeyPem: string
  fingerprint: string
}

/** Public half of the identity, committed at tests/first100/trusted-identity.json. */
export interface PinnedIdentity {
  publicKeyPem: string
  fingerprint: string
}

/** A stable short fingerprint of the public key (32 hex chars of sha256). */
export function fingerprintOf(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem, 'utf8').digest('hex').slice(0, 32)
}

/** Generate a fresh Ed25519 identity and persist ONLY the public pin. */
export function generateIdentity(repoRoot = resolveRepoRoot()): SigningIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const pin: PinnedIdentity = { publicKeyPem, fingerprint: fingerprintOf(publicKeyPem) }
  const pinPath = join(repoRoot, 'tests/first100/trusted-identity.json')
  writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`, 'utf8')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem,
    fingerprint: pin.fingerprint,
  }
}

/** Absolute path of the local signing key. */
export function keyringPath(): string {
  return join(homedir(), '.config/dsh-first100/first100-signing.key')
}

/** Load the signing key: env base64 PKCS8, else the local keyring file. */
export function loadSigningKeyPem(): string {
  const fromEnv = process.env.DSH_FIRST100_SIGNING_KEY
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return Buffer.from(fromEnv, 'base64').toString('utf8')
  }
  const path = keyringPath()
  if (!existsSync(path)) {
    throw new Error('No First-100 signing key: set DSH_FIRST100_SIGNING_KEY (base64 PKCS8 PEM) or run attest.ts --install-key <key.pem>')
  }
  return readFileSync(path, 'utf8')
}

/** Persist a private key PEM to the local keyring with 0600 permissions. */
export function installKey(privateKeyPem: string): string {
  const dir = join(homedir(), '.config/dsh-first100')
  mkdirSync(dir, { recursive: true })
  const path = keyringPath()
  writeFileSync(path, privateKeyPem, { mode: 0o600, encoding: 'utf8' })
  chmodSync(path, 0o600)
  return path
}

/** Sign an observation JSON file on disk, writing the hex signature back into it. */
export function signObservationFile(filePath: string, privateKeyPem: string): string {
  const observation = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  const signature = signObservation(privateKeyPem, observation)
  observation.signature = signature
  writeFileSync(filePath, `${JSON.stringify(observation, null, 2)}\n`, 'utf8')
  return signature
}

/** Verify an observation JSON file on disk against a public key PEM. */
export function verifyObservationFile(filePath: string, publicKeyPem: string): boolean {
  const observation = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  return verifyObservationSignature(publicKeyPem, observation)
}

// CLI
const args = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes('--generate-identity')) {
    const identity = generateIdentity()
    const keyPath = installKey(identity.privateKeyPem)
    console.log('generated identity; public pin -> tests/first100/trusted-identity.json')
    console.log(`fingerprint: ${identity.fingerprint}`)
    console.log(`private key installed -> ${keyPath} (0600; never committed)`)
    process.exit(0)
  }
  const installIndex = args.indexOf('--install-key')
  if (installIndex !== -1) {
    const keyPath = args[installIndex + 1]
    if (keyPath === undefined) {
      console.error('usage: attest.ts --install-key <path-to-private-key.pem>')
      process.exit(1)
    }
    const path = installKey(readFileSync(keyPath, 'utf8'))
    console.log(`installed private key -> ${path} (0600)`)
    process.exit(0)
  }
  const signIndex = args.indexOf('--sign')
  if (signIndex !== -1) {
    const filePath = args[signIndex + 1]
    if (filePath === undefined) {
      console.error('usage: attest.ts --sign <observation.json>')
      process.exit(1)
    }
    const signature = signObservationFile(filePath, loadSigningKeyPem())
    console.log(`signed ${filePath}: ${signature.slice(0, 16)}…`)
    process.exit(0)
  }
  const verifyIndex = args.indexOf('--verify')
  if (verifyIndex !== -1) {
    const filePath = args[verifyIndex + 1]
    if (filePath === undefined) {
      console.error('usage: attest.ts --verify <observation.json> [--public-key-pem <path>]')
      process.exit(1)
    }
    const publicIndex = args.indexOf('--public-key-pem')
    const publicKeyPem = publicIndex !== -1
      ? readFileSync(args[publicIndex + 1] ?? '', 'utf8')
      : loadPinnedIdentity().publicKeyPem
    if (verifyObservationFile(filePath, publicKeyPem)) {
      console.log(`verified ${filePath} against pinned identity`)
      process.exit(0)
    }
    console.error(`SIGNATURE FAIL: ${filePath} does not verify`)
    process.exit(1)
  }
  console.error(
    'usage: attest.ts --generate-identity | --install-key <key.pem> | --sign <observation.json> | --verify <observation.json> [--public-key-pem <path>]',
  )
  process.exit(1)
}
