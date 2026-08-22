import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface TenantKey {
  readonly tenantId: string
  readonly keyId: string
  readonly key: Buffer
  readonly createdAt: number
  readonly rotatedAt?: number
}

export class KeyRing {
  private readonly keys = new Map<string, TenantKey[]>()
  private readonly activeKeys = new Map<string, TenantKey>()

  generateTenantKey(tenantId: string): TenantKey {
    const keyId = randomBytes(8).toString('hex')
    const key = randomBytes(32)
    const tenantKey: TenantKey = { tenantId, keyId, key, createdAt: Date.now() }
    const list = this.keys.get(tenantId) ?? []
    list.push(tenantKey)
    this.keys.set(tenantId, list)
    this.activeKeys.set(tenantId, tenantKey)
    return tenantKey
  }

  rotateKey(tenantId: string): TenantKey {
    const old = this.activeKeys.get(tenantId)
    if (old) {
      const rotated: TenantKey = { ...old, rotatedAt: Date.now() }
      const list = this.keys.get(tenantId) ?? []
      const idx = list.findIndex(k => k.keyId === old.keyId)
      if (idx >= 0) list[idx] = rotated
    }
    return this.generateTenantKey(tenantId)
  }

  getActiveKey(tenantId: string): TenantKey | undefined {
    return this.activeKeys.get(tenantId)
  }

  encrypt(tenantId: string, plaintext: Buffer): { ciphertext: Buffer; keyId: string; iv: Buffer } | undefined {
    const key = this.activeKeys.get(tenantId)
    if (!key) return undefined
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', key.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    return { ciphertext, keyId: key.keyId, iv }
  }

  decrypt(tenantId: string, keyId: string, iv: Buffer, ciphertext: Buffer): Buffer | undefined {
    const list = this.keys.get(tenantId)
    if (!list) return undefined
    const key = list.find(k => k.keyId === keyId)
    if (!key) return undefined
    const authTag = ciphertext.subarray(-16)
    const encrypted = ciphertext.subarray(0, -16)
    const decipher = createDecipheriv('aes-256-gcm', key.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  }
}
